// ============================================================
// Playing partner matching — loading. Reads the member, the pool
// they can be matched from, and the history that rules people out,
// then hands it all to the pure rules (./rules).
//
// Server-only, service role throughout: the survey answers it
// reads (gender, habits, preferences) are RLS-locked to everyone,
// and the only callers are admin routes and the member's own
// recommendation feed.
// ============================================================

import type { createAdminClient } from '@/lib/supabase-server'
import type { IndustryCategory } from '@/types'
import { nameOrEmail, titleCaseName } from '@/lib/utils'
import {
  HABITS,
  MATCH_GOALS,
  PLAY_TIMES,
  PREF_GENDERS,
  COMPANY_SIZES,
  optionLabel,
  toMatchProfile,
  type Attitude,
  type MatchProfile,
  type PrefSkill,
} from './survey'
import { matchChips, mutualFit, pairScore, templatedNote, type MatchSubject } from './rules'

type AdminClient = ReturnType<typeof createAdminClient>

/** A member who pressed Not now isn't listed for that member again for this long. */
export const DISMISS_COOLDOWN_DAYS = 90
/** The window "recommended N times lately" and the queue's "not matched lately" count over. */
export const RECENT_DAYS = 30
/** How many of a list the admin screen loads at a time (queue, search, candidates). */
export const MATCHING_PAGE_SIZE = 20

const DAY_MS = 86_400_000

const PROFILE_FIELDS =
  'role_title, business_name, industry_category, value_offered, value_sought, ' +
  'non_golf_hobbies, nonprofits, handicap_index, avatar_url, profile_visible'

const memberSelect = (matchEmbed: string) =>
  'id, first_name, last_name, email, home_course_id, membership_status, last_sign_in, ' +
  `profile:member_profiles(${PROFILE_FIELDS}), ` +
  `match:${matchEmbed}(*), ` +
  'home_course:courses!members_home_course_id_fkey(name)'

/** Everything the rules and the admin screen need about one member. */
export const MATCH_MEMBER_SELECT = memberSelect('member_match_profiles')
/** The same, keeping only members who have a survey row (filter on `match.*`). */
export const SURVEYED_MEMBER_SELECT = memberSelect('member_match_profiles!inner')

interface ProfileRow {
  role_title: string | null
  business_name: string | null
  industry_category: IndustryCategory | null
  value_offered: string | null
  value_sought: string | null
  non_golf_hobbies: string | null
  nonprofits: string[] | null
  handicap_index: number | null
  avatar_url: string | null
  profile_visible: boolean | null
}

export interface MatchMemberRow {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  home_course_id: string | null
  membership_status: string
  last_sign_in: string | null
  profile: ProfileRow | ProfileRow[] | null
  match: Record<string, unknown> | Record<string, unknown>[] | null
  home_course: { name: string } | { name: string }[] | null
}

/** PostgREST hands back a one-to-one embed as an object or a one-item array. */
function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

/** A member as the admin screens show them. */
export interface MatchPerson {
  id: string
  name: string
  firstName: string
  lastName: string
  avatarUrl: string | null
  roleTitle: string | null
  businessName: string | null
  industry: IndustryCategory | null
  courseName: string | null
}

export function toPerson(row: MatchMemberRow): MatchPerson {
  const profile = one(row.profile)
  return {
    id: row.id,
    name: nameOrEmail(`${row.first_name ?? ''} ${row.last_name ?? ''}`, row.email) || 'Unnamed member',
    // Names arrive lower-cased from GHL; the note and the push say them aloud.
    firstName: titleCaseName(row.first_name ?? ''),
    lastName: titleCaseName(row.last_name ?? ''),
    avatarUrl: profile?.avatar_url ?? null,
    roleTitle: profile?.role_title ?? null,
    businessName: profile?.business_name ?? null,
    industry: profile?.industry_category ?? null,
    courseName: one(row.home_course)?.name ?? null,
  }
}

export function matchProfileOf(row: MatchMemberRow): MatchProfile {
  return toMatchProfile(one(row.match) as Partial<Record<keyof MatchProfile, unknown>> | null)
}

export function toSubject(row: MatchMemberRow): MatchSubject {
  const profile = one(row.profile)
  return {
    id: row.id,
    firstName: titleCaseName((row.first_name ?? '').trim()),
    industry: profile?.industry_category ?? null,
    valueOffered: profile?.value_offered ?? null,
    valueSought: profile?.value_sought ?? null,
    hobbies: profile?.non_golf_hobbies ?? null,
    nonprofits: profile?.nonprofits ?? [],
    handicap: profile?.handicap_index ?? null,
    lastSignIn: row.last_sign_in,
    match: matchProfileOf(row),
  }
}

/** Whether a member can be matched at all: in the pool and surveyed. */
export function isMatchable(row: MatchMemberRow): boolean {
  const match = matchProfileOf(row)
  return row.membership_status === 'active'
    && Boolean(match.completed_at)
    && match.open_to_suggestions
    && one(row.profile)?.profile_visible !== false
}

export async function loadMatchMember(admin: AdminClient, memberId: string): Promise<MatchMemberRow | null> {
  const { data, error } = await admin.from('members').select(MATCH_MEMBER_SELECT).eq('id', memberId).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as unknown as MatchMemberRow) ?? null
}

// ---- The member, summarised for the admin -------------------

export interface MatchSummary extends MatchPerson {
  surveyCompleted: boolean
  openToSuggestions: boolean
  handicap: number | null
  offers: string | null
  seeks: string | null
  goals: string[]
  playTimes: string[]
  attitude: string
  companySize: string
  /** Golf preferences in words — admin screen only, never a member's. */
  preferences: string[]
}

/** The survey's options are full sentences; the admin's summary needs a word or two. */
const ATTITUDE_SHORT: Record<Attitude, string> = {
  serious:  'Serious, competitive',
  friendly: 'Friendly competition',
  relaxed:  'Relaxed, casual',
}
const SKILL_SHORT: Record<Exclude<PrefSkill, 'any'>, string> = {
  excellent: 'Excellent golfers',
  good:      'Good golfers',
  new:       'New golfers',
}

export function summarize(row: MatchMemberRow): MatchSummary {
  const profile = one(row.profile)
  const m = matchProfileOf(row)
  const preferences: string[] = []
  if (m.pref_gender && m.pref_gender !== 'any') preferences.push(`Gender: ${optionLabel(PREF_GENDERS, m.pref_gender)}`)
  if (m.pref_skill && m.pref_skill !== 'any') preferences.push(`${SKILL_SHORT[m.pref_skill]} only`)
  if (m.pref_attitude && m.pref_attitude !== 'any') preferences.push(`${ATTITUDE_SHORT[m.pref_attitude]} only`)
  const minds = HABITS.filter(h => m[`minds_${h.key}`] === true).map(h => h.key)
  if (minds.length > 0) preferences.push(`Minds ${minds.join(', ')}`)
  if (m.completed_at && preferences.length === 0) preferences.push('No preferences')

  return {
    ...toPerson(row),
    surveyCompleted: Boolean(m.completed_at),
    openToSuggestions: m.open_to_suggestions,
    handicap: profile?.handicap_index ?? null,
    offers: profile?.value_offered ?? null,
    seeks: profile?.value_sought ?? null,
    goals: m.goals.map(g => optionLabel(MATCH_GOALS, g)),
    playTimes: m.play_times.map(t => optionLabel(PLAY_TIMES, t)),
    attitude: m.attitude ? ATTITUDE_SHORT[m.attitude] : '',
    companySize: optionLabel(COMPANY_SIZES, m.company_size),
    preferences,
  }
}

// ---- Candidates ---------------------------------------------

export interface Candidate extends MatchPerson {
  score: number
  chips: string[]
  /** The pre-filled note, from the rules. The admin edits it before sending. */
  note: string
  handicap: number | null
  /** Times this candidate was recommended to anyone in the last RECENT_DAYS. */
  recentRecommendations: number
  /** When this candidate was recommended to the member (still open), or null. */
  recommendedAt: string | null
  /**
   * When the member was recommended to this candidate (still open), or null.
   * The candidate has already been told about the member, so sending the
   * pair the other way would say it twice.
   */
  suggestedAt: string | null
}

export interface CandidateList {
  candidates: Candidate[]
  /** Removed by either member's golf preferences. */
  ruledOut: number
}

interface SuggestionRow {
  member_id: string
  suggested_id: string
  dismissed: boolean
  dismissed_at: string | null
  created_at: string
}

/** Everyone this member has shared a round with, played or booked. */
export async function playedWithIds(admin: AdminClient, memberId: string): Promise<Set<string>> {
  const { data, error } = await admin.rpc('members_played_with', { p_member_id: memberId })
  if (error) throw new Error(error.message)
  return new Set(((data ?? []) as Array<{ member_id: string }>).map(r => r.member_id))
}

/**
 * Who can be recommended to `member`, best first. Left out before scoring:
 * anyone outside their course, inactive, hidden, opted out, unsurveyed,
 * already played with, a pair either of them dismissed in the last
 * DISMISS_COOLDOWN_DAYS — and anyone either member's golf preferences rule out.
 * A pair already sent, in either direction, stays listed but locked
 * (recommendedAt / suggestedAt).
 */
export async function buildCandidateList(
  admin: AdminClient,
  member: MatchMemberRow,
  now: Date = new Date(),
): Promise<CandidateList> {
  if (!member.home_course_id) return { candidates: [], ruledOut: 0 }

  const recentSince = new Date(now.getTime() - RECENT_DAYS * DAY_MS).toISOString()
  const [poolRes, played, ownRes, reverseRes, recentRes] = await Promise.all([
    admin
      .from('members')
      .select(MATCH_MEMBER_SELECT)
      .eq('home_course_id', member.home_course_id)
      .eq('membership_status', 'active')
      .neq('id', member.id),
    playedWithIds(admin, member.id),
    admin
      .from('play_suggestions')
      .select('member_id, suggested_id, dismissed, dismissed_at, created_at')
      .eq('member_id', member.id),
    // The same pairs the other way: the member recommended to someone else.
    admin
      .from('play_suggestions')
      .select('member_id, suggested_id, dismissed, dismissed_at, created_at')
      .eq('suggested_id', member.id)
      .not('recommended_by', 'is', null),
    admin
      .from('play_suggestions')
      .select('suggested_id')
      .not('recommended_by', 'is', null)
      .gte('created_at', recentSince),
  ])
  if (poolRes.error) throw new Error(poolRes.error.message)
  if (ownRes.error) throw new Error(ownRes.error.message)
  if (reverseRes.error) throw new Error(reverseRes.error.message)
  if (recentRes.error) throw new Error(recentRes.error.message)

  const dismissedUntil = now.getTime() - DISMISS_COOLDOWN_DAYS * DAY_MS
  const own = new Map(((ownRes.data ?? []) as SuggestionRow[]).map(r => [r.suggested_id, r]))
  const reverse = new Map(((reverseRes.data ?? []) as SuggestionRow[]).map(r => [r.member_id, r]))
  const dismissedLately = (r: SuggestionRow | undefined) =>
    Boolean(r?.dismissed && r.dismissed_at && new Date(r.dismissed_at).getTime() > dismissedUntil)
  const recentCount = new Map<string, number>()
  for (const r of (recentRes.data ?? []) as Array<{ suggested_id: string }>) {
    recentCount.set(r.suggested_id, (recentCount.get(r.suggested_id) ?? 0) + 1)
  }

  const me = toSubject(member)
  const candidates: Candidate[] = []
  let ruledOut = 0

  for (const row of (poolRes.data ?? []) as unknown as MatchMemberRow[]) {
    if (!isMatchable(row) || played.has(row.id)) continue
    const previous = own.get(row.id)
    const theirs = reverse.get(row.id)
    // Not now from either of them is a no for the pair, for a while.
    if (dismissedLately(previous) || dismissedLately(theirs)) continue

    const them = toSubject(row)
    if (!mutualFit(me, them)) {
      ruledOut++
      continue
    }
    candidates.push({
      ...toPerson(row),
      score: pairScore(me, them, now),
      chips: matchChips(me, them),
      note: templatedNote(me, them),
      handicap: them.handicap,
      recentRecommendations: recentCount.get(row.id) ?? 0,
      recommendedAt: previous && !previous.dismissed ? previous.created_at : null,
      suggestedAt: theirs && !theirs.dismissed ? theirs.created_at : null,
    })
  }

  candidates.sort((x, y) => y.score - x.score || x.name.localeCompare(y.name))
  // Whole, not paged: the send route checks picks against all of it, and the
  // admin screen pages it (GET /api/admin/matching/[memberId]?offset=).
  return { candidates, ruledOut }
}

// ---- What happened to what was sent -------------------------

export type RecommendationOutcome = 'sent' | 'seen' | 'dismissed' | 'messaged' | 'round_booked' | 'played'

export interface SentRecommendation {
  id: string
  candidate: { id: string; name: string }
  note: string | null
  sentAt: string
  outcome: RecommendationOutcome
}

interface SentRow {
  id: string
  suggested_id: string
  note: string | null
  created_at: string
  seen_at: string | null
  dismissed: boolean
  suggested: { first_name: string | null; last_name: string | null; email: string | null } | null
}

/**
 * The recommendations admins have sent this member, newest first, each with
 * how far it got. A round together beats a message, a message beats a look.
 */
export async function loadSentRecommendations(admin: AdminClient, memberId: string): Promise<SentRecommendation[]> {
  const { data, error } = await admin
    .from('play_suggestions')
    .select('id, suggested_id, note, created_at, seen_at, dismissed, suggested:members!play_suggestions_suggested_id_fkey(first_name, last_name, email)')
    .eq('member_id', memberId)
    .not('recommended_by', 'is', null)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as unknown as SentRow[]
  if (rows.length === 0) return []

  const ids = rows.map(r => r.suggested_id)
  const [roundsRes, messaged] = await Promise.all([
    admin.rpc('members_played_with', { p_member_id: memberId }),
    messagedSince(admin, memberId, ids, rows[rows.length - 1]?.created_at ?? new Date().toISOString()),
  ])
  if (roundsRes.error) throw new Error(roundsRes.error.message)
  const rounds = new Map(
    ((roundsRes.data ?? []) as Array<{ member_id: string; last_played: string | null; next_round: string | null }>)
      .map(r => [r.member_id, r]),
  )

  return rows.map(r => {
    const sentDay = r.created_at.slice(0, 10)
    const round = rounds.get(r.suggested_id)
    let outcome: RecommendationOutcome = r.seen_at ? 'seen' : 'sent'
    if (r.dismissed) outcome = 'dismissed'
    const lastMessage = messaged.get(r.suggested_id)
    if (lastMessage && lastMessage >= r.created_at) outcome = 'messaged'
    if (round?.next_round) outcome = 'round_booked'
    if (round?.last_played && round.last_played >= sentDay) outcome = 'played'
    const s = r.suggested
    return {
      id: r.id,
      candidate: {
        id: r.suggested_id,
        name: nameOrEmail(`${s?.first_name ?? ''} ${s?.last_name ?? ''}`, s?.email) || 'Unnamed member',
      },
      note: r.note,
      sentAt: r.created_at,
      outcome,
    }
  })
}

/**
 * For each of `others`, the latest message in a direct conversation with
 * `memberId` sent on or after `since`. Absent = no message since.
 */
async function messagedSince(
  admin: AdminClient,
  memberId: string,
  others: string[],
  since: string,
): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  const { data: mine, error } = await admin
    .from('conversation_participants')
    .select('conversation_id, conversation:conversations!inner(type)')
    .eq('member_id', memberId)
    .eq('conversation.type', 'direct')
  if (error || !mine?.length) return result

  const convIds = mine.map(r => r.conversation_id as string)
  const { data: theirs } = await admin
    .from('conversation_participants')
    .select('conversation_id, member_id')
    .in('conversation_id', convIds)
    .in('member_id', others)
  if (!theirs?.length) return result

  const otherByConv = new Map(theirs.map(r => [r.conversation_id as string, r.member_id as string]))
  const { data: messages } = await admin
    .from('messages')
    .select('conversation_id, created_at')
    .in('conversation_id', [...otherByConv.keys()])
    .gte('created_at', since)
    .is('deleted_at', null)
  for (const m of messages ?? []) {
    const other = otherByConv.get(m.conversation_id as string)
    if (!other) continue
    const at = m.created_at as string
    const known = result.get(other)
    if (!known || at > known) result.set(other, at)
  }
  return result
}
