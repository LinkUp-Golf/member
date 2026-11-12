// ============================================================
// The admin's matching queue: members waiting for a match, and
// search across everyone. Server-only (service role). Both are
// paged — the admin screen loads MATCHING_PAGE_SIZE at a time and
// asks for more as the list scrolls.
// ============================================================

import type { createAdminClient } from '@/lib/supabase-server'
import {
  MATCH_MEMBER_SELECT,
  MATCHING_PAGE_SIZE,
  RECENT_DAYS,
  SURVEYED_MEMBER_SELECT,
  matchProfileOf,
  toPerson,
  type MatchMemberRow,
  type MatchPerson,
} from './candidates'

type AdminClient = ReturnType<typeof createAdminClient>

const DAY_MS = 86_400_000

export interface QueueEntry extends MatchPerson {
  surveyCompletedAt: string | null
  /** The latest recommendation an admin sent this member, or null. */
  lastRecommendedAt: string | null
}

export interface Page {
  offset: number
  limit: number
}

export interface QueuePage {
  entries: QueueEntry[]
  /** Everything the list holds, across every page. */
  total: number
  /** Active members who have completed the survey; null for a search. */
  surveyed: number | null
}

/** A page from query params, clamped: 0 or more, 1 to 50 at a time. */
export function parsePage(params: URLSearchParams): Page {
  const offset = Math.max(0, Math.floor(Number(params.get('offset')) || 0))
  const limit = Math.min(50, Math.max(1, Math.floor(Number(params.get('limit')) || MATCHING_PAGE_SIZE)))
  return { offset, limit }
}

async function lastRecommendedFor(admin: AdminClient, memberIds: string[], since?: string): Promise<Map<string, string>> {
  const latest = new Map<string, string>()
  if (memberIds.length === 0 && !since) return latest
  let query = admin
    .from('play_suggestions')
    .select('member_id, created_at')
    .not('recommended_by', 'is', null)
  if (since) query = query.gte('created_at', since)
  else query = query.in('member_id', memberIds)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  for (const r of (data ?? []) as Array<{ member_id: string; created_at: string }>) {
    const current = latest.get(r.member_id)
    if (!current || r.created_at > current) latest.set(r.member_id, r.created_at)
  }
  return latest
}

/**
 * Members waiting for a match: Curated Introductions on, survey complete, and
 * no recommendation in the last RECENT_DAYS. Newest survey first, so the member
 * who just finished it hears back while it's fresh. A member who switched it
 * off is out of the queue as well as out of other people's lists.
 *
 * Ordered by a value on the embedded survey row, so the list is sorted here
 * rather than by PostgREST; the page is cut after.
 */
export async function loadQueue(admin: AdminClient, page: Page, now: Date = new Date()): Promise<QueuePage> {
  const since = new Date(now.getTime() - RECENT_DAYS * DAY_MS).toISOString()
  const [profilesRes, recent] = await Promise.all([
    admin
      .from('members')
      .select(SURVEYED_MEMBER_SELECT)
      .eq('membership_status', 'active')
      .not('home_course_id', 'is', null)
      .not('match.completed_at', 'is', null)
      .eq('match.open_to_suggestions', true),
    lastRecommendedFor(admin, [], since),
  ])
  if (profilesRes.error) throw new Error(profilesRes.error.message)

  const rows = (profilesRes.data ?? []) as unknown as MatchMemberRow[]
  const waiting = rows
    .filter(r => !recent.has(r.id))
    .map(r => ({ row: r, completedAt: matchProfileOf(r).completed_at }))
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '') || a.row.id.localeCompare(b.row.id))
  const slice = waiting.slice(page.offset, page.offset + page.limit)

  // Older than the window, but still worth showing: "last matched in March".
  const earlier = await lastRecommendedFor(admin, slice.map(w => w.row.id))
  const entries = slice.map(({ row, completedAt }) => ({
    ...toPerson(row),
    surveyCompletedAt: completedAt,
    lastRecommendedAt: earlier.get(row.id) ?? null,
  }))

  return { entries, total: waiting.length, surveyed: rows.length }
}

/** Only what's safe inside a PostgREST or-filter: letters, digits and a few marks. */
export function searchTerm(raw: string): string {
  return raw.replace(/[^\p{L}\p{N}@.\-' ]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
}

/**
 * Any member with a course, by name or email — surveyed or not. Every word
 * has to match somewhere ("sam ort" finds Sam Ortiz), and the database pages
 * it, so the count is exact.
 */
export async function searchMembers(admin: AdminClient, raw: string, page: Page): Promise<QueuePage> {
  const words = searchTerm(raw).split(' ').filter(Boolean).slice(0, 4)
  if (words.length === 0) return { entries: [], total: 0, surveyed: null }

  let query = admin
    .from('members')
    .select(MATCH_MEMBER_SELECT, { count: 'exact' })
    .not('home_course_id', 'is', null)
  for (const w of words) {
    query = query.or(`first_name.ilike.%${w}%,last_name.ilike.%${w}%,email.ilike.%${w}%`)
  }
  const { data, error, count } = await query
    .order('first_name')
    .order('id')
    .range(page.offset, page.offset + page.limit - 1)
  if (error) throw new Error(error.message)

  const rows = (data ?? []) as unknown as MatchMemberRow[]
  const recommended = await lastRecommendedFor(admin, rows.map(r => r.id))
  return {
    entries: rows.map(r => ({
      ...toPerson(r),
      surveyCompletedAt: matchProfileOf(r).completed_at,
      lastRecommendedAt: recommended.get(r.id) ?? null,
    })),
    total: count ?? rows.length,
    surveyed: null,
  }
}
