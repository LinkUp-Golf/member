// ============================================================
// Former members — someone whose membership tag was removed in GHL.
//
// Removing a member's access tag (e.g. member-active-SD) ends their
// membership. The sync marks the member row FORMER_MEMBER_STATUS, which takes
// them out of the member directory and every other "active members" list at
// once. What they can still reach depends on whether they have a round ahead:
//
//   - A round still on the books (a booking seat of theirs, or a hosted-round
//     reservation, dated today or later): they keep the app until the end of
//     the day of the last one, except the things that are for members only —
//     booking a new round, member chat, Refer a Member and Curated
//     Introductions (isClosedToFormerMember / isApiClosedToFormerMember).
//   - Nothing ahead: no access at all. Sign-in is refused and an open session
//     is signed out by the next API call (403 MEMBERSHIP_REVOKED).
//
// A contact that was never a member (a prospect, a member's guest) isn't a
// former member: they keep the guest rules in @/lib/auth/guest-paths. Nor is
// anyone still holding another access or role tag — the sync only marks a
// member former when GHL leaves them with none.
//
// Client's rule, 2026-11-27 — see docs/decisions.md.
//
// Edge-safe (no Node APIs, no server-only imports): the middleware uses it.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { MY_BOOKINGS_TAB, MY_BOOKINGS_PATH, AVIARA_TIMEZONE } from '@/lib/constants'
import { hasAnyAccessTag, hasMembershipTag } from '@/lib/ghl/tags'

/**
 * The members.membership_status of a former member. 'cancelled' has been in
 * the membership_status enum since the first migration and nothing else
 * writes it, so no migration is needed. 'suspended' stays an admin's word.
 */
export const FORMER_MEMBER_STATUS = 'cancelled'

/** Whether this member row is a former member's. Admins never are. */
export function isFormerMember(row: {
  membership_status?: string | null
  is_admin?: boolean | null
} | null | undefined): boolean {
  return !!row && !row.is_admin && row.membership_status === FORMER_MEMBER_STATUS
}

/**
 * Whether a contact with these tags, whose member row looked like `prior`
 * before this sync, has just become (or still is) a former member.
 *
 * It takes holding no access or role tag at all — someone left with a host or
 * referral-partner role keeps that workspace, and someone left with
 * member-guest or nbd client is a guest — and having been a member:
 * membership_start_date is stamped by the sync for every contact that ever
 * held a membership tag, and a row already marked former stays former.
 */
export function becomesFormerMember(
  tags: string[],
  prior: { membership_start_date?: string | null; membership_status?: string | null } | null | undefined,
): boolean {
  if (hasAnyAccessTag(tags)) return false
  if (!prior) return false
  return !!prior.membership_start_date || prior.membership_status === FORMER_MEMBER_STATUS
}

/**
 * Whether two tag lists disagree on holding a membership, or on having any
 * access at all — i.e. whether the member row's copy of the tags is out of
 * date in a way that matters. withAuth re-syncs the row when it is.
 */
export function membershipChanged(stored: string[], live: string[]): boolean {
  return hasMembershipTag(stored) !== hasMembershipTag(live) || hasAnyAccessTag(stored) !== hasAnyAccessTag(live)
}

// ---- What stays closed while they still have a round ahead ----

/** Member-app pages a former member can't open, even with a round ahead. */
const CLOSED_PAGES = [
  '/messages',          // member chat
  '/more/referrals',    // Refer a Member
  '/more/match-profile', // Curated Introductions
]

/**
 * Whether a former member is kept off this page. `tab` is the ?tab= value:
 * /book stays open on My bookings (and its invitations), where their
 * remaining rounds are, and closed on the tab that books a new one.
 */
export function isClosedToFormerMember(pathname: string, tab: string | null): boolean {
  if (CLOSED_PAGES.some(p => pathname === p || pathname.startsWith(`${p}/`))) return true
  return pathname === '/book' && tab !== MY_BOOKINGS_TAB
}

/** Where a former member is sent from a closed page. */
export const FORMER_MEMBER_LANDING_PATH = MY_BOOKINGS_PATH

/**
 * Whether a former member is refused this API call, even with a round ahead.
 * The pages above are presentation; this is the gate.
 */
export function isApiClosedToFormerMember(pathname: string, method: string): boolean {
  const m = method.toUpperCase()
  // Member chat, Refer a Member, Curated Introductions — every method.
  if (/^\/api\/(conversations|referrals|recommendations|match-survey)(\/|$)/.test(pathname)) return true
  // A new round: booking one, finding one to book, adding players to one, or
  // reserving a spot on a hosted round. Cancelling stays open (DELETE).
  if (/^\/api\/bookings\/(create|availability|check-guests)(\/|$)/.test(pathname)) return true
  if (m === 'POST' && /^\/api\/bookings\/[^/]+\/players\/?$/.test(pathname)) return true
  if (m === 'POST' && /^\/api\/hosted-events\/[^/]+\/register\/?$/.test(pathname)) return true
  return false
}

// ---- How long they keep the app ------------------------------

/** Booking statuses that no longer hold a seat — the round isn't ahead of them. */
const NOT_GOING_AHEAD = ['cancelled', 'waitlist']

/** Today's date at the venue, 'YYYY-MM-DD'. One community, one timezone. */
export function todayForFormerMembers(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: AVIARA_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/**
 * The last of these round dates that is today or later, or null when none is.
 * A former member keeps the app through that whole day.
 */
export function accessUntil(roundDates: Array<string | null | undefined>, today: string): string | null {
  let last: string | null = null
  for (const d of roundDates) {
    if (!d || d < today) continue
    if (!last || d > last) last = d
  }
  return last
}

/**
 * The date a former member keeps the app until, or null when they have no
 * round ahead and so no access. Reads their own rows: the session's client is
 * enough under RLS (bookings let a member read rows they book or are named
 * on; registrations, their own), and so is the service-role client.
 *
 * Throws on a read error. Callers decide which way to fail: refusing on a blip
 * would sign a former member out of a round they still have.
 */
export async function formerMemberAccessUntil(
  supabase: SupabaseClient,
  memberId: string,
  now: Date = new Date(),
): Promise<string | null> {
  const today = todayForFormerMembers(now)

  const [bookings, registrations] = await Promise.all([
    supabase
      .from('bookings')
      .select('booking_date')
      .or(`member_id.eq.${memberId},player_member_id.eq.${memberId}`)
      .gte('booking_date', today)
      .not('status', 'in', `(${NOT_GOING_AHEAD.join(',')})`),
    supabase
      .from('hosted_event_registrations')
      .select('hosted_event:hosted_events(event_date)')
      .eq('member_id', memberId)
      .eq('status', 'reserved'),
  ])

  if (bookings.error) throw new Error(bookings.error.message)
  if (registrations.error) throw new Error(registrations.error.message)

  const dates: Array<string | null | undefined> = [
    ...(bookings.data ?? []).map(b => b.booking_date as string | null),
    ...(registrations.data ?? []).map(r => {
      const ev = r.hosted_event as { event_date?: string | null } | Array<{ event_date?: string | null }> | null
      return Array.isArray(ev) ? ev[0]?.event_date : ev?.event_date
    }),
  ]
  return accessUntil(dates, today)
}

/**
 * Whether sign-in should be refused: a former member with no round ahead.
 * `row` is their member row as the sign-in sync just left it.
 *
 * Fails open on a read error. This is the door, not the lock: withAuth asks
 * the same question on every API call and signs them out if the answer is no.
 */
export async function formerMemberShutOut(
  supabase: SupabaseClient,
  memberId: string,
  row: { membership_status?: string | null; is_admin?: boolean | null } | null | undefined,
): Promise<boolean> {
  if (!isFormerMember(row)) return false
  try {
    return (await formerMemberAccessUntil(supabase, memberId)) === null
  } catch {
    return false
  }
}
