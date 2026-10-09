// Who a booker is recommended to bring along: the players from their own
// cancelled rounds.
//
// A member who cancels a round and books another usually means to play with
// the same people, and the people on the cancelled round have nothing telling
// them there's a new one. So each of the booker's upcoming rounds lists:
//
//   • the members on the booker's own recent cancelled rows, and
//   • the members who cancelled a spot at the same venue on the same day —
//     people who wanted to play that event and dropped out of it,
//
// and the booker can ping them — a direct message asking them along — or add
// them outright. The same-event ones come first: they wanted this very day.
//
// A ping asks someone to take a spot, so the pings waiting on a round can never
// outnumber the spots the day has open: pinging five people for two spots is
// promising a round to three who can't have one.
//
// The rules are pure and tested; the loader at the bottom reads the rows.

import type { createAdminClient } from '@/lib/supabase-server'
import { playingMemberId } from '@/lib/bookings/players'
import { NON_HOLDING_STATUSES } from '@/lib/bookings/availability'

type AdminClient = ReturnType<typeof createAdminClient>

/** How far back a cancelled round still suggests its players. */
export const RECOMMEND_LOOKBACK_DAYS = 90

export interface CancelledRow {
  member_id: string
  player_member_id: string | null
  guest_name: string | null
  booking_date: string
}

/**
 * The members on the booker's cancelled rows, most recent round first, each
 * once — minus the booker and anyone already holding a spot that day.
 */
export function recommendFromCancelled(
  rows: CancelledRow[],
  selfId: string,
  alreadyPlaying: ReadonlySet<string>,
): string[] {
  const sorted = [...rows].sort((a, b) => b.booking_date.localeCompare(a.booking_date))
  const out: string[] = []
  const seen = new Set<string>()
  for (const row of sorted) {
    const id = playingMemberId(row)
    if (!id || id === selfId || alreadyPlaying.has(id) || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/**
 * How many more people may be pinged about a round. A ping still waiting is
 * one the day's open spots must be able to honour; someone pinged who has since
 * booked is already counted in the open spots, so isn't counted again.
 */
export function pingsRemaining(openSpots: number, waitingPings: number): number {
  return Math.max(0, openSpots - waitingPings)
}

export interface RecommendedPlayer {
  memberId: string
  firstName: string
  lastName: string
  /** Only as a label, for a member with no name — see nameOrEmail. */
  labelEmail?: string | null
  avatarUrl: string | null
  /** Set once the booker has pinged or invited them about this round. */
  pinged: 'ping' | 'invite' | null
}

export interface RecommendationContext {
  recommended: RecommendedPlayer[]
  /** Pings about this round that the member hasn't acted on yet. */
  waitingPings: number
}

/** Members holding a spot at this venue on this day. */
export async function membersPlayingOn(
  admin: AdminClient,
  courseId: string,
  bookingDate: string,
): Promise<Set<string>> {
  const { data } = await admin
    .from('bookings')
    .select('member_id, player_member_id, guest_name')
    .eq('course_id', courseId)
    .eq('booking_date', bookingDate)
    .not('status', 'in', NON_HOLDING_STATUSES)
  const ids = new Set<string>()
  for (const row of data ?? []) {
    const id = playingMemberId(row)
    if (id) ids.add(id)
  }
  return ids
}

export async function loadRecommendations(
  admin: AdminClient,
  booking: { id: string; member_id: string; course_id: string; booking_date: string },
): Promise<RecommendationContext> {
  const since = new Date(Date.now() - RECOMMEND_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)

  const [sameEventRes, cancelledRes, playing, pingsRes] = await Promise.all([
    admin
      .from('bookings')
      .select('member_id, player_member_id, guest_name, booking_date')
      .eq('course_id', booking.course_id)
      .eq('booking_date', booking.booking_date)
      .eq('status', 'cancelled'),
    admin
      .from('bookings')
      .select('member_id, player_member_id, guest_name, booking_date')
      .eq('member_id', booking.member_id)
      .eq('status', 'cancelled')
      .gte('booking_date', since),
    membersPlayingOn(admin, booking.course_id, booking.booking_date),
    admin
      .from('booking_player_pings')
      .select('member_id, kind')
      .eq('booking_id', booking.id),
  ])

  const pings = new Map<string, 'ping' | 'invite'>(
    (pingsRes.data ?? []).map(p => [p.member_id as string, p.kind as 'ping' | 'invite']),
  )
  const waitingPings = [...pings].filter(([id, kind]) => kind === 'ping' && !playing.has(id)).length

  const ids = [...new Set([
    ...recommendFromCancelled((sameEventRes.data ?? []) as CancelledRow[], booking.member_id, playing),
    ...recommendFromCancelled((cancelledRes.data ?? []) as CancelledRow[], booking.member_id, playing),
  ])]
  if (ids.length === 0) return { recommended: [], waitingPings }

  const { data: members } = await admin
    .from('members')
    .select('id, first_name, last_name, email, membership_status, profile:member_profiles(avatar_url)')
    .in('id', ids)

  const byId = new Map((members ?? []).map(m => [m.id as string, m]))
  const recommended: RecommendedPlayer[] = []
  for (const id of ids) {
    const m = byId.get(id)
    // A member who has since left isn't someone to invite.
    if (!m || m.membership_status !== 'active') continue
    const profile = Array.isArray(m.profile) ? m.profile[0] : m.profile
    const hasName = Boolean(m.first_name?.trim() || m.last_name?.trim())
    recommended.push({
      memberId: id,
      firstName: m.first_name ?? '',
      lastName: m.last_name ?? '',
      labelEmail: hasName ? undefined : m.email,
      avatarUrl: (profile as { avatar_url?: string | null } | null)?.avatar_url ?? null,
      pinged: pings.get(id) ?? null,
    })
  }
  return { recommended, waitingPings }
}
