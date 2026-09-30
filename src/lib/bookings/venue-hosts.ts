// Who is running the round at each venue.
//
// A member looking at "who's playing" on a day wants the tee sheet as the club
// has it, and the first name on a tee sheet is whoever is taking the group out.
// That person is the user staffing the venue's GHL calendar — its primary team
// member — because that is what makes the appointments theirs and what the
// member's own booking confirmation names.
//
// Reading it from the calendar rather than from host_venues is deliberate. The
// calendar is what actually decides who the appointment belongs to: a venue can
// have two hosts granted to it, be staffed by someone who isn't a LinkUp host at
// all, or have been re-staffed in GHL this morning. host_venues is how we grant
// the right to list rounds; teamMembers[isPrimary] is who is there.
//
// The name comes from our side where we have it — hosts.name is what a host
// operates under, which is the name their members know — and from the GHL user
// otherwise. A venue whose calendar names nobody simply has no host row in the
// sheet; nothing here is required for the day to be readable.
//
// Every call is cached (the calendar's rules for 30 minutes, the user list for
// 30 minutes) and nothing throws: this decorates a list, and a GHL outage must
// cost the decoration rather than the list.

import { getCalendarBookingRules, listGHLUsers } from '@/lib/ghl/client'
import { getCache, withCache } from '@/lib/cache'
import { GHL_USERS_NS, GHL_USERS_TTL_MS, ghlUsersKey } from '@/lib/cache/keys'
import { logger } from '@/lib/logger'
import type { createAdminClient } from '@/lib/supabase-server'

type AdminClient = ReturnType<typeof createAdminClient>

/** How many calendars we ask GHL about at once. Mirrors GHL_CONCURRENCY. */
const CONCURRENCY = 5

/** The person at the head of a venue's tee sheet. */
export interface VenueHost {
  /** The calendar's primary team member — the user the appointments belong to. */
  ghlUserId: string
  name: string
  /**
   * Set when the host is one of our members, so the sheet can open their
   * profile. Null for a club employee who staffs the calendar and isn't in
   * LinkUp — they're still the host of the round, they just have no page.
   */
  memberId: string | null
  avatarUrl: string | null
}

/** The location's users, cached — read only to put a name to a user id. */
async function usersById(): Promise<Map<string, { firstName: string; lastName: string }>> {
  const users = await withCache(
    getCache(GHL_USERS_NS),
    ghlUsersKey(),
    () => listGHLUsers(),
    GHL_USERS_TTL_MS,
  )
  const map = new Map<string, { firstName: string; lastName: string }>()
  for (const u of users ?? []) {
    if (!u.id) continue
    map.set(u.id, {
      firstName: (u.firstName ?? '').trim(),
      lastName: (u.lastName ?? '').trim(),
    })
  }
  return map
}

/** Runs `fn` over `items` with at most `limit` in flight. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      const item = items[index]
      if (item === undefined) continue
      results[index] = await fn(item)
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * Picks the name to show for a calendar's primary user.
 *
 * Our own first, because hosts.name is the name a host chose to operate under
 * and the one their members have seen on the round. Pure, and exported for the
 * tests — the order is the part that's a decision rather than a lookup.
 */
export function hostDisplayName(
  hostName: string | null | undefined,
  ghlUser: { firstName: string; lastName: string } | undefined,
): string {
  const own = hostName?.trim()
  if (own) return own
  const full = [ghlUser?.firstName, ghlUser?.lastName].filter(Boolean).join(' ').trim()
  return full
}

/**
 * The host of each venue, keyed by course id.
 *
 * A venue is absent from the result when its calendar names nobody, when GHL
 * can't be reached, or when the user it names can't be given a name at all —
 * three different problems with the same right answer, which is to show the
 * day's players without a host above them.
 */
export async function loadVenueHosts(
  admin: AdminClient,
  courses: Array<{ id: string; ghl_calendar_id?: string | null }>,
): Promise<Record<string, VenueHost>> {
  const withCalendar = courses.filter(c => !!c.ghl_calendar_id?.trim())
  if (withCalendar.length === 0) return {}

  // Who staffs each calendar. pickCalendarAssignee inside this is the
  // teamMembers[isPrimary] rule; cached per calendar, so a second member opening
  // the same month pays for none of it.
  const staffed = await mapWithConcurrency(withCalendar, CONCURRENCY, async course => {
    const rules = await getCalendarBookingRules(course.ghl_calendar_id as string)
    return { courseId: course.id, ghlUserId: rules?.assigneeId?.trim() || null }
  })

  const byCourse = staffed.filter((s): s is { courseId: string; ghlUserId: string } => !!s.ghlUserId)
  const userIds = Array.from(new Set(byCourse.map(s => s.ghlUserId)))
  if (userIds.length === 0) return {}

  // Our own hosts, by the GHL user they were provisioned as.
  const { data: hostRows, error } = await admin
    .from('hosts')
    .select('name, member_id, ghl_user_id, status')
    .in('ghl_user_id', userIds)

  if (error) {
    // Not fatal: the GHL user list can still name them. Worth a line, because
    // the name shown would silently change from "Dana's Golf Days" to "Dana
    // Okafor" and nobody would know why.
    logger.warn('Could not read hosts for the venue tee sheets', {
      action: 'venue_hosts.hosts_failed',
      errorMessage: error.message,
      metadata: { users: userIds.length },
    })
  }

  const hostByUser = new Map<string, { name: string; memberId: string | null }>()
  for (const row of hostRows ?? []) {
    const userId = (row.ghl_user_id as string | null)?.trim()
    if (!userId || row.status !== 'active') continue
    hostByUser.set(userId, {
      name: (row.name as string) ?? '',
      memberId: (row.member_id as string | null) ?? null,
    })
  }

  // Their photo, where the host is a member. Fetched separately rather than
  // embedded through hosts → members → member_profiles: PostgREST refuses a
  // two-hop embed and would take the whole query with it, which would read as
  // "no venue has a host" (the same reason loadPlayersForRange splits its own).
  const memberIds = Array.from(
    new Set(
      Array.from(hostByUser.values())
        .map(h => h.memberId)
        .filter((id): id is string => !!id),
    ),
  )
  const avatarByMember = new Map<string, string | null>()
  if (memberIds.length > 0) {
    const { data: profiles } = await admin
      .from('member_profiles')
      .select('member_id, avatar_url')
      .in('member_id', memberIds)
    for (const p of profiles ?? []) {
      avatarByMember.set(p.member_id as string, (p.avatar_url as string | null) ?? null)
    }
  }

  // Only asked for when somebody's name is still missing, so a location whose
  // hosts are all ours never pays for it.
  const needsGhlName = userIds.some(id => !hostByUser.get(id)?.name?.trim())
  const ghlUsers = needsGhlName ? await usersById() : new Map()

  const out: Record<string, VenueHost> = {}
  for (const { courseId, ghlUserId } of byCourse) {
    const own = hostByUser.get(ghlUserId)
    const name = hostDisplayName(own?.name, ghlUsers.get(ghlUserId))
    if (!name) continue
    out[courseId] = {
      ghlUserId,
      name,
      memberId: own?.memberId ?? null,
      avatarUrl: own?.memberId ? (avatarByMember.get(own.memberId) ?? null) : null,
    }
  }

  return out
}
