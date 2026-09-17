// Who's playing — the members booked at each venue on each day of a month.
//
// The aggregated calendar on /book shows where a member can play; this is the
// other half of deciding, who else will be there. It came back after the
// per-venue booking screen (which carried a "Who's playing" row for one day)
// was folded into the calendar.
//
// A player is a member, never a non-member guest: a guest has no profile to
// show or open. That's a booker's own row (no guest_name) and a member invited
// onto someone else's booking (player_member_id) — both are on the tee sheet.

import type { createAdminClient } from '@/lib/supabase-server'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Rounds that are actually going ahead, matching GET /api/bookings/day and a
 * host's roster (loadBookedAttendees). A tentative or awaiting-approval booking
 * may never become a round, so it isn't someone "playing" yet.
 */
export const PLAYING_STATUSES = ['availability_confirmed', 'payment_confirmed', 'confirmed'] as const

export interface CalendarPlayer {
  memberId: string
  firstName: string
  lastName: string
  avatarUrl: string | null
  courseId: string
  /** Wall-clock 'HH:mm:ss' at the venue. */
  teeTime: string
  isSelf: boolean
}

interface PlayingRow {
  member_id: string
  player_member_id: string | null
  guest_name: string | null
  course_id: string
  booking_date: string
  tee_time: string
}

/**
 * The member a booking row seats, or null for a non-member guest.
 * Exported for the tests — the three row shapes are easy to get wrong.
 */
export function playingMemberId(row: Pick<PlayingRow, 'member_id' | 'player_member_id' | 'guest_name'>): string | null {
  if (row.player_member_id) return row.player_member_id
  return row.guest_name ? null : row.member_id
}

/**
 * Groups rows into 'YYYY-MM-DD' → players, one entry per member per venue per
 * tee time (a retried submission can leave the same person twice), ordered by
 * tee time and then name so a day reads the way its tee sheet does.
 */
export function groupPlayersByDay(
  rows: PlayingRow[],
  members: Map<string, { firstName: string; lastName: string; avatarUrl: string | null }>,
  selfId: string,
): Record<string, CalendarPlayer[]> {
  const days: Record<string, CalendarPlayer[]> = {}
  const seen = new Set<string>()

  for (const row of rows) {
    const memberId = playingMemberId(row)
    if (!memberId) continue
    const member = members.get(memberId)
    if (!member) continue

    const date = row.booking_date.slice(0, 10)
    const key = `${date}|${row.course_id}|${row.tee_time}|${memberId}`
    if (seen.has(key)) continue
    seen.add(key)

    const list = days[date] ?? (days[date] = [])
    list.push({
      memberId,
      firstName: member.firstName,
      lastName: member.lastName,
      avatarUrl: member.avatarUrl,
      courseId: row.course_id,
      teeTime: row.tee_time,
      isSelf: memberId === selfId,
    })
  }

  for (const list of Object.values(days)) {
    list.sort(
      (a, b) =>
        a.teeTime.localeCompare(b.teeTime) ||
        `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`),
    )
  }
  return days
}

/** Players at the given venues between two dates, inclusive. */
export async function loadPlayersForRange(
  admin: AdminClient,
  params: { courseIds: string[]; startDate: string; endDate: string; selfId: string },
): Promise<Record<string, CalendarPlayer[]>> {
  const { courseIds, startDate, endDate, selfId } = params
  if (courseIds.length === 0 || startDate > endDate) return {}

  const { data: bookings } = await admin
    .from('bookings')
    .select('member_id, player_member_id, guest_name, course_id, booking_date, tee_time')
    .in('course_id', courseIds)
    .gte('booking_date', startDate)
    .lte('booking_date', endDate)
    .in('status', PLAYING_STATUSES)

  const rows = (bookings ?? []) as PlayingRow[]
  const memberIds = Array.from(
    new Set(rows.map(playingMemberId).filter((id): id is string => !!id)),
  )
  if (memberIds.length === 0) return {}

  // Fetched separately rather than joined: embedding member_profiles through
  // bookings → members makes PostgREST refuse the whole query, which would read
  // as "nobody's playing" (same reason as loadBookedAttendees).
  const { data: memberRows } = await admin
    .from('members')
    .select('id, first_name, last_name, profile:member_profiles(avatar_url)')
    .in('id', memberIds)

  const members = new Map<string, { firstName: string; lastName: string; avatarUrl: string | null }>()
  for (const m of memberRows ?? []) {
    const profile = Array.isArray(m.profile) ? m.profile[0] : m.profile
    members.set(m.id as string, {
      firstName: (m.first_name as string) ?? '',
      lastName: (m.last_name as string) ?? '',
      avatarUrl: (profile as { avatar_url: string | null } | null)?.avatar_url ?? null,
    })
  }

  return groupPlayersByDay(rows, members, selfId)
}
