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

  return events.map(e => {
    const f = filled.get(e.id) ?? 0
    return {
      ...e,
      member_price: memberPrice(e.member_guest_rate),
      filled_spots: f,
      remaining_spots: Math.max(0, e.total_spots - f),
      ...(opts.memberId ? { is_registered: mine.has(e.id) } : {}),
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
