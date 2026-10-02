// ============================================================
// LinkUp Golf — Hosted events
// Pure pricing/spot helpers plus server-side enrichment (spot counts, member
// price, whether the caller is registered) and a host's event statistics.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { normaliseTeeTime } from '@/lib/hosts/tee-time'
import { PLAYING_STATUSES, playingMemberId } from '@/lib/bookings/players'
import { HOST_MEMBER_PRICE_MARKUP_PERCENT } from '@/lib/constants'
import type { EventPlayer, HostedEvent, HostStats } from '@/types'
import { loadCreditSummary } from '@/lib/credits'

type AdminClient = SupabaseClient

/**
 * LinkUp's cut of a hosted round: a percentage of the host's guest rate,
 * rounded to the cent.
 *
 * Rounded here rather than only at the end, so the fee is a figure that can be
 * quoted on its own and still add up to the price beside it.
 */
export function hostMarkup(memberGuestRate: number): number {
  return Math.round(memberGuestRate * HOST_MEMBER_PRICE_MARKUP_PERCENT) / 100
}

/** The price a member pays: the host's guest rate plus the markup on it. */
export function memberPrice(memberGuestRate: number): number {
  return Math.round((memberGuestRate + hostMarkup(memberGuestRate)) * 100) / 100
}

/**
 * Whether a host may propose an event at the given course.
 *
 * Scope is read from hosts.venues_unrestricted, not inferred from the venue rows
 * being empty. The old rule — "no host_venues rows means every course" — existed
 * for hosts granted before venue scoping, but it could not be told apart from a
 * grant that produced nothing, so a failed or empty grant silently promoted a
 * scoped host to an unscoped one. The column says which is meant.
 *
 * Booking-sourced events skip this — their course comes from a real tee time the
 * host already holds.
 */
export async function hostCanUseCourse(admin: AdminClient, hostId: string, courseId: string): Promise<boolean> {
  const { data: host } = await admin
    .from('hosts')
    .select('venues_unrestricted')
    .eq('id', hostId)
    .maybeSingle()

  if (host?.venues_unrestricted) return true

  const { data } = await admin
    .from('host_venues')
    .select('course_id')
    .eq('host_id', hostId)
    .eq('course_id', courseId)
    .maybeSingle()

  return !!data
}

/**
 * The tee time each date being listed should be stored with.
 *
 * A host picks dates and gives each one its own time, because two days at a
 * club rarely tee off at the same time — and each date becomes its own
 * hosted_events row, so each stores the time it was given. `tee_times` is that
 * map, keyed by date; `tee_time` is the one-for-all form an older client sends,
 * filling any date the map doesn't name.
 *
 * Every date has one by the time this runs — validateHostedEventPayload insists
 * — so null is only reachable for a caller that skipped it. Normalising rather
 * than sanitising is what makes that safe: what comes out is "HH:MM" or nothing,
 * never text that has to be escaped.
 */
export function resolveTeeTimes(
  dates: string[],
  body: { tee_time?: unknown; tee_times?: unknown },
): Map<string, string | null> {
  const clean = (v: unknown) => normaliseTeeTime(v) || null

  const shared = clean(body.tee_time)
  const perDate =
    body.tee_times && typeof body.tee_times === 'object' && !Array.isArray(body.tee_times)
      ? (body.tee_times as Record<string, unknown>)
      : {}

  return new Map(
    dates.map(date => [date, date in perDate ? clean(perDate[date]) : shared]),
  )
}

/** Statuses in which a member can still reserve a spot. */
export const JOINABLE_STATUSES = ['upcoming'] as const

/**
 * Only an unpublished event can be published. The gate exists because approving
 * is also when the LinkUp team creates the GHL calendar the event books against,
 * so re-approving something already live would mean nothing.
 */
export const APPROVABLE_STATUSES = ['pending_approval'] as const

/**
 * What status a hosted round opens at — and so whether anyone has to approve it.
 *
 * The gate protects one thing: a round must not be bookable before the club
 * behind it is set up. At a venue that is already active that is already true, so
 * the round is published as it's created and nobody is asked to confirm a fact
 * the database already has. A club proposed through the host form has no calendar
 * and no agreed rate, so its rounds wait, and approving the venue is what
 * releases them.
 *
 * Anything other than an active course is treated as waiting. A venue in some
 * state we haven't thought of is not a venue to publish against.
 */
export function newEventStatus(
  course: { approval_status?: string | null } | null | undefined,
): 'upcoming' | 'pending_approval' {
  return course?.approval_status === 'active' ? 'upcoming' : 'pending_approval'
}

/**
 * A listing can be taken down while it waits for approval or while it's live. An
 * event that has run (completed / pending_credit_approval / credits_awarded)
 * happened — taking it down would rewrite history rather than prevent it.
 */
export const REJECTABLE_STATUSES = ['pending_approval', 'upcoming'] as const

/**
 * Whether an admin can publish this event, and if not, why.
 *
 * A past date is refused separately from a wrong status: publishing a round whose
 * date has gone would put something in member browse nobody can attend, and the
 * admin's next move is a takedown, not a retry.
 */
export function canApproveEvent(
  status: string,
  eventDate: string,
  today = new Date().toISOString().slice(0, 10)
): { ok: true } | { ok: false; reason: 'status' | 'past_date' } {
  if (!(APPROVABLE_STATUSES as readonly string[]).includes(status)) return { ok: false, reason: 'status' }
  if (eventDate < today) return { ok: false, reason: 'past_date' }
  return { ok: true }
}

/** Whether an admin can take this event down. */
export function canRejectEvent(status: string): boolean {
  return (REJECTABLE_STATUSES as readonly string[]).includes(status)
}

/**
 * Whether an event exists as far as an ordinary member is concerned.
 *
 * Browse already filters to 'upcoming', but a direct id would still resolve, so
 * the same rule has to hold on the single-event route — otherwise the gate is a
 * listing filter rather than a gate. Its own host and admins see everything.
 */
export function isMemberVisible(status: string): boolean {
  return status !== 'pending_approval'
}

/**
 * Whether a host may upload proof for an event.
 *
 * Proof only makes sense once the event has taken place:
 *   completed               — it ran and the cron has closed it
 *   pending_credit_approval — replacing proof already submitted
 *   upcoming, date arrived  — it ran today; don't make the host wait for the
 *                             daily completion cron to catch up
 *
 * Never for an upcoming event still in the future, cancelled, or
 * credits_awarded (already settled).
 *
 * Isomorphic on purpose: the route enforces it and the UI decides whether to
 * show the button, and the two must not drift.
 */
export function canUploadProof(status: string, eventDate: string, today = new Date().toISOString().slice(0, 10)): boolean {
  if (status === 'completed' || status === 'pending_credit_approval') return true
  if (status === 'upcoming' && eventDate <= today) return true
  return false
}

/**
 * Whether the host can mark who attended this round.
 *
 * The same window as the proof photo, and for the same reason: both are things
 * only the round itself can answer, and the host answers them standing at the
 * club with one phone. Shared so the checkbox and the route that saves it can't
 * disagree about when it exists — a sheet offering ticks the server refuses is
 * worse than a sheet that doesn't offer them.
 */
export function canMarkAttendance(
  status: string,
  eventDate: string,
  today?: string,
): boolean {
  return canUploadProof(status, eventDate, today)
}

/** How a proof note reads; the UI maps these to colours. */
export type ProofNoteTone = 'pending' | 'rejected' | 'sent'

export interface ProofState {
  hasProof: boolean
  canUpload: boolean
  /** Button label. 'Replace pic' the moment one is in. */
  label: 'Upload pic' | 'Replace pic'
  note: { tone: ProofNoteTone; text: string } | null
}

/**
 * What to tell a host about proof on one of their events.
 *
 * Exists because the status alone can't answer it. A same-day upload leaves the
 * event in `upcoming` on purpose (see canUploadProof), so status said nothing
 * had happened while a photo was sitting in the table — the button kept reading
 * "Upload pic" and no line anywhere said one had been submitted. And a proof
 * an admin sends back returns the event to `completed`, which is
 * indistinguishable from never having uploaded at all unless the rejection
 * reason is surfaced.
 *
 * So the answer is derived from status, date, whether a proof row exists, and
 * the rejection reason together — once, here, rather than three times across
 * two screens.
 */
export function proofState(params: {
  status: string
  eventDate: string
  hasProof: boolean
  /** Set when an admin sent the proof back. Only meaningful on 'completed'. */
  rejectionReason?: string | null
  today?: string
}): ProofState {
  const { status, eventDate, hasProof } = params
  const reason = params.rejectionReason?.trim() || null
  const canUpload = canUploadProof(status, eventDate, params.today)
  const label = hasProof ? 'Replace pic' : 'Upload pic'

  // Awaiting the credit decision. Say that replacing is still possible — it is,
  // and a host who spots a bad photo shouldn't assume it's too late.
  if (status === 'pending_credit_approval') {
    return {
      hasProof, canUpload, label,
      note: { tone: 'pending', text: 'Proof sent — waiting on your credit. You can still replace the photo.' },
    }
  }

  // Sent back. Without this the host sees a bare "Finished" row and an upload
  // button, with nothing to say their photo was reviewed and refused.
  if (status === 'completed' && reason) {
    return { hasProof, canUpload, label, note: { tone: 'rejected', text: `Proof not accepted: ${reason}` } }
  }

  if (hasProof) {
    // Uploaded on the day, while the round is still live and listed. It reaches
    // the credit queue when the nightly job closes the event out.
    if (status === 'upcoming') {
      return {
        hasProof, canUpload, label,
        note: { tone: 'sent', text: 'Proof sent — it goes for credit review once the round closes out.' },
      }
    }
    // A proof exists but the event never moved on: the status update after the
    // upload didn't land. Worth showing rather than looking like nothing was sent.
    if (status === 'completed') {
      return { hasProof, canUpload, label, note: { tone: 'sent', text: 'Proof sent — waiting on review.' } }
    }
  }

  // Cancelled, settled, or nothing uploaded yet — the status label already says it.
  return { hasProof, canUpload, label, note: null }
}

/**
 * A member with a booking at the venue on the day a round runs.
 *
 * A member who books a tee time at Aviara on the 2nd is at the host's round on
 * the 2nd — they are the same afternoon at the same club. Reserving through the
 * event was never the only way to end up in it, so the roster is built from
 * both.
 *
 * Who counts is decided by playingMemberId, the same rule the member-facing
 * "who's playing" list uses, and the statuses are that list's PLAYING_STATUSES —
 * so the host's roster and the one members see can't disagree. They used to:
 * this read only rows with no guest_name, which is the booker's own row, and so
 * missed every member invited onto someone else's booking. A group of four
 * members at the venue showed up on the host's round as one person.
 *
 * A non-member guest is still not an attendee here — they have no profile to
 * show — and a member with two tee times the same day is still one person.
 */
export interface BookedAttendee {
  member_id: string
  first_name: string
  last_name: string
  avatar_url: string | null
  tee_time: string | null
}

const venueDayKey = (courseId: string, date: string) => `${courseId}|${date.slice(0, 10)}`

/** What it takes to show a person: their name and their face. */
export interface MemberCard {
  first_name: string
  last_name: string
  avatar_url: string | null
}

/**
 * Names and avatars for a set of member ids.
 *
 * Its own read rather than a join, wherever it's called from: asking `members`
 * for avatar_url — which lives on member_profiles — makes PostgREST reject the
 * whole query, and a rejected roster query reads as "nobody is playing".
 */
async function loadMemberCards(
  admin: AdminClient,
  memberIds: string[],
): Promise<Map<string, MemberCard>> {
  const byId = new Map<string, MemberCard>()
  if (memberIds.length === 0) return byId

  const { data: members } = await admin
    .from('members')
    .select('id, first_name, last_name, profile:member_profiles(avatar_url)')
    .in('id', memberIds)

  for (const m of members ?? []) {
    const profile = Array.isArray(m.profile) ? m.profile[0] : m.profile
    byId.set(m.id as string, {
      first_name: m.first_name as string,
      last_name: m.last_name as string,
      avatar_url: (profile as { avatar_url: string | null } | null)?.avatar_url ?? null,
    })
  }
  return byId
}

/** Booked members for each (venue, day) the given events sit on. */
export async function loadBookedAttendees(
  admin: AdminClient,
  events: { course_id: string; event_date: string }[],
): Promise<Map<string, BookedAttendee[]>> {
  const out = new Map<string, BookedAttendee[]>()
  if (events.length === 0) return out

  const courseIds = Array.from(new Set(events.map(e => e.course_id)))
  const dates = Array.from(new Set(events.map(e => e.event_date.slice(0, 10))))
  const wanted = new Set(events.map(e => venueDayKey(e.course_id, e.event_date)))

  // Two `in` filters are a cross product of the pairs actually wanted, so the
  // rows are narrowed back down below rather than in the query.
  const { data: bookings } = await admin
    .from('bookings')
    // guest_name and player_member_id come along because between them they say
    // which member a row seats — see playingMemberId.
    .select('member_id, player_member_id, guest_name, course_id, booking_date, tee_time')
    .in('course_id', courseIds)
    .in('booking_date', dates)
    .in('status', [...PLAYING_STATUSES])

  const rows = (bookings ?? []).filter(b =>
    wanted.has(venueDayKey(b.course_id as string, b.booking_date as string)),
  )
  if (rows.length === 0) return out

  // The member each row seats, dropping the non-member guests as we go.
  const seated = rows
    .map(r => ({ row: r, memberId: playingMemberId(r as Parameters<typeof playingMemberId>[0]) }))
    .filter((x): x is { row: (typeof rows)[number]; memberId: string } => !!x.memberId)
  if (seated.length === 0) return out

  const byId = await loadMemberCards(admin, Array.from(new Set(seated.map(x => x.memberId))))

  for (const { row: r, memberId } of seated) {
    const member = byId.get(memberId)
    if (!member) continue
    const key = venueDayKey(r.course_id as string, r.booking_date as string)
    const list = out.get(key) ?? []
    // One entry per member per day — a member with two tee times the same day
    // is still one person at the round.
    if (list.some(a => a.member_id === memberId)) continue
    list.push({
      member_id: memberId,
      first_name: member.first_name,
      last_name: member.last_name,
      avatar_url: member.avatar_url,
      tee_time: (r.tee_time as string) ?? null,
    })
    out.set(key, list)
  }

  return out
}

/** Key for looking a group up in what loadBookedAttendees returns. */
export const bookedAttendeeKey = venueDayKey

/**
 * Everyone at one round, in the order the host should read them.
 *
 * Reservations first, then members who only booked the venue that day. Anyone
 * who did both appears once, as a reservation — that is the more specific
 * commitment, and two faces for one person would overstate the round.
 *
 * A reserved member whose card couldn't be loaded is dropped rather than shown
 * nameless: the count beside the faces comes from filled_spots, which is counted
 * from the registrations themselves, so the number stays right either way.
 *
 * `attended` is who the host has ticked as present (hosted_event_attendance).
 * It's carried on the roster rather than fetched beside it because the two are
 * read together everywhere: the host's list draws the checkbox from it, and a
 * name with no tick is a member nobody has said anything about yet.
 *
 * Pure, and exported for its test — the dedupe is the part worth pinning down.
 */
export function rosterFor(
  reservedIds: string[],
  cards: Map<string, MemberCard>,
  attendees: BookedAttendee[],
  attended?: ReadonlySet<string>,
): EventPlayer[] {
  const players: EventPlayer[] = []
  const seen = new Set<string>()

  for (const id of reservedIds) {
    const card = cards.get(id)
    if (!card || seen.has(id)) continue
    seen.add(id)
    players.push({ member_id: id, ...card, source: 'reserved', attended: !!attended?.has(id) })
  }

  for (const a of attendees) {
    if (seen.has(a.member_id)) continue
    seen.add(a.member_id)
    players.push({
      member_id: a.member_id,
      first_name: a.first_name,
      last_name: a.last_name,
      avatar_url: a.avatar_url,
      source: 'booking',
      attended: !!attended?.has(a.member_id),
    })
  }

  return players
}

/**
 * Annotate events with member_price, filled/remaining spots and (when a member
 * is given) whether they already hold an active reservation. Batches the
 * registration count into a single query across all events.
 *
 * `withPlayers` adds the roster itself — everyone at the round, with their name,
 * face and whether the host marked them present. Opt-in rather than always,
 * because it names members: the host's own screens ask for it, the member-facing
 * endpoints don't.
 */
export async function enrichHostedEvents(
  admin: AdminClient,
  events: HostedEvent[],
  opts: { memberId?: string; withPlayers?: boolean } = {}
): Promise<HostedEvent[]> {
  if (events.length === 0) return []

  const ids = events.map(e => e.id)
  const { data: regs } = await admin
    .from('hosted_event_registrations')
    .select('hosted_event_id, member_id')
    .in('hosted_event_id', ids)
    .eq('status', 'reserved')

  const filled = new Map<string, number>()
  const mine = new Set<string>()
  /** Reserved member ids per event, kept only when the roster was asked for. */
  const reservedBy = new Map<string, string[]>()
  for (const r of (regs ?? []) as { hosted_event_id: string; member_id: string }[]) {
    filled.set(r.hosted_event_id, (filled.get(r.hosted_event_id) ?? 0) + 1)
    if (opts.memberId && r.member_id === opts.memberId) mine.add(r.hosted_event_id)
    if (opts.withPlayers) {
      reservedBy.set(r.hosted_event_id, [
        ...(reservedBy.get(r.hosted_event_id) ?? []),
        r.member_id,
      ])
    }
  }

  // Members who reached the round by booking the venue that day rather than
  // reserving through the event.
  //
  // Deliberately NOT folded into filled_spots: that number is what
  // reserve_hosted_event_spot enforces capacity against in SQL, and quietly
  // widening it here would make the UI refuse reservations the database would
  // still accept. It's reported alongside so host-facing screens can show the
  // real roster while capacity keeps one definition.
  const booked = await loadBookedAttendees(admin, events)

  // The people who reserved through the event. loadBookedAttendees already has
  // the other half's names, so this is the one extra read the roster costs.
  const reservedCards = opts.withPlayers
    ? await loadMemberCards(
        admin,
        Array.from(new Set(Array.from(reservedBy.values()).flat())),
      )
    : new Map<string, MemberCard>()

  // Who the host ticked as present, per event. One query for the whole list, and
  // only where the roster was asked for — it's a property of the names, and the
  // endpoints that don't name members have no use for it.
  const attendedByEvent = new Map<string, Set<string>>()
  if (opts.withPlayers) {
    const { data: marks } = await admin
      .from('hosted_event_attendance')
      .select('hosted_event_id, member_id')
      .in('hosted_event_id', ids)
    for (const m of (marks ?? []) as { hosted_event_id: string; member_id: string }[]) {
      const set = attendedByEvent.get(m.hosted_event_id) ?? new Set<string>()
      set.add(m.member_id)
      attendedByEvent.set(m.hosted_event_id, set)
    }
  }

  return events.map(e => {
    const f = filled.get(e.id) ?? 0
    const attendees = booked.get(venueDayKey(e.course_id, e.event_date)) ?? []
    return {
      ...e,
      member_price: memberPrice(e.member_guest_rate),
      filled_spots: f,
      remaining_spots: Math.max(0, e.total_spots - f),
      booked_attendees: attendees,
      booked_spots: attendees.length,
      ...(opts.withPlayers
        ? {
            players: rosterFor(
              reservedBy.get(e.id) ?? [],
              reservedCards,
              attendees,
              attendedByEvent.get(e.id),
            ),
          }
        : {}),
      ...(opts.memberId
        ? {
            // Booking the venue that day connects a member to the round just as
            // reserving does, so both count as "you're in this one".
            is_registered:
              mine.has(e.id) || attendees.some(a => a.member_id === opts.memberId),
          }
        : {}),
    }
  })
}

/**
 * Event counts by lifecycle bucket plus the credit summary, for a dashboard.
 * Events are the host's; credit belongs to the member behind that host, since
 * the wallet is member-scoped and can also hold non-hosting credit.
 */
export async function loadHostStats(
  admin: AdminClient,
  hostId: string,
  memberId: string
): Promise<HostStats> {
  const [{ data: events }, credits] = await Promise.all([
    admin.from('hosted_events').select('status').eq('host_id', hostId),
    loadCreditSummary(admin, memberId),
  ])

  const rows = (events ?? []) as { status: string }[]
  // An event "happened" once it's completed, awaiting credit, or credited.
  const OCCURRED = new Set(['completed', 'pending_credit_approval', 'credits_awarded'])

  return {
    // Submitted but not published. Its own bucket because otherwise a host whose
    // events are all waiting on approval sees zero everywhere and a non-zero
    // total, which reads as if their events vanished.
    pendingCount: rows.filter(r => r.status === 'pending_approval').length,
    upcomingCount: rows.filter(r => r.status === 'upcoming').length,
    completedCount: rows.filter(r => OCCURRED.has(r.status)).length,
    cancelledCount: rows.filter(r => r.status === 'cancelled').length,
    totalEvents: rows.length,
    credits,
  }
}
