// ============================================================
// LinkUp Golf — Hosted events
// Pure pricing/spot helpers plus server-side enrichment (spot counts, member
// price, whether the caller is registered) and a host's event statistics.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { HOST_MEMBER_PRICE_MARKUP_USD } from '@/lib/constants'
import type { HostedEvent, HostStats } from '@/types'
import { loadCreditSummary } from '@/lib/credits'

type AdminClient = SupabaseClient

/** The price a member pays: the host's guest rate plus the fixed markup. */
export function memberPrice(memberGuestRate: number): number {
  return Math.round((memberGuestRate + HOST_MEMBER_PRICE_MARKUP_USD) * 100) / 100
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

/** Statuses in which a member can still reserve a spot. */
export const JOINABLE_STATUSES = ['upcoming'] as const

/**
 * Only an unpublished event can be published. The gate exists because approving
 * is also when the LinkUp team creates the GHL calendar the event books against,
 * so re-approving something already live would mean nothing.
 */
export const APPROVABLE_STATUSES = ['pending_approval'] as const

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
 * A member with a booking at the venue on the day a round runs.
 *
 * A member who books a tee time at Aviara on the 2nd is at the host's round on
 * the 2nd — they are the same afternoon at the same club. Reserving through the
 * event was never the only way to end up in it, so the roster is built from
 * both.
 *
 * Only rows with no guest_name are members; the additional-player rows a group
 * booking creates for non-members are somebody's guest, not a separate
 * attendee. Statuses match GET /api/bookings/day, the app's existing answer to
 * "who is playing here that day", so the host's roster and the member-facing
 * one can't disagree.
 */
export interface BookedAttendee {
  member_id: string
  first_name: string
  last_name: string
  avatar_url: string | null
  tee_time: string | null
}

const BOOKED_STATUSES = ['availability_confirmed', 'payment_confirmed', 'confirmed']

const venueDayKey = (courseId: string, date: string) => `${courseId}|${date.slice(0, 10)}`

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
    .select('member_id, course_id, booking_date, tee_time')
    .in('course_id', courseIds)
    .in('booking_date', dates)
    .is('guest_name', null)
    .in('status', BOOKED_STATUSES)

  const rows = (bookings ?? []).filter(b =>
    wanted.has(venueDayKey(b.course_id as string, b.booking_date as string)),
  )
  if (rows.length === 0) return out

  // Fetched separately rather than joined: asking members for avatar_url (which
  // lives on member_profiles) makes PostgREST reject the whole query, which
  // then reads as "nobody booked".
  const memberIds = Array.from(new Set(rows.map(r => r.member_id as string)))
  const { data: members } = await admin
    .from('members')
    .select('id, first_name, last_name, profile:member_profiles(avatar_url)')
    .in('id', memberIds)

  const byId = new Map<string, { first_name: string; last_name: string; avatar_url: string | null }>()
  for (const m of members ?? []) {
    const profile = Array.isArray(m.profile) ? m.profile[0] : m.profile
    byId.set(m.id as string, {
      first_name: m.first_name as string,
      last_name: m.last_name as string,
      avatar_url: (profile as { avatar_url: string | null } | null)?.avatar_url ?? null,
    })
  }

  for (const r of rows) {
    const member = byId.get(r.member_id as string)
    if (!member) continue
    const key = venueDayKey(r.course_id as string, r.booking_date as string)
    const list = out.get(key) ?? []
    // One entry per member per day — a member with two tee times the same day
    // is still one person at the round.
    if (list.some(a => a.member_id === r.member_id)) continue
    list.push({
      member_id: r.member_id as string,
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
 * Annotate events with member_price, filled/remaining spots and (when a member
 * is given) whether they already hold an active reservation. Batches the
 * registration count into a single query across all events.
 */
export async function enrichHostedEvents(
  admin: AdminClient,
  events: HostedEvent[],
  opts: { memberId?: string } = {}
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
  for (const r of (regs ?? []) as { hosted_event_id: string; member_id: string }[]) {
    filled.set(r.hosted_event_id, (filled.get(r.hosted_event_id) ?? 0) + 1)
    if (opts.memberId && r.member_id === opts.memberId) mine.add(r.hosted_event_id)
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
