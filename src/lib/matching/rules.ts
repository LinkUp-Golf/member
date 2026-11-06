// ============================================================
// Playing partner matching — the rules behind the admin's
// candidate list. Pure: no I/O, `now` passed in, so every rule is
// tested directly (src/__tests__/matching-rules.test.ts).
//
// Golf preferences are filters, never weights: a candidate a
// preference rules out is left off the list entirely, so an admin
// can't send a match the member said they don't want. They're
// checked both ways — B is listed for A only if B fits A's
// preferences and A fits B's — and a candidate who hasn't answered
// the question a preference needs is left out, because the
// preference can't be checked.
//
// Everyone left is scored out of 100. The score only orders the
// admin's list; the admin decides.
//
// Nothing here ever puts a preference, a gender or a habit into
// words: the chips and the note are built from the networking
// answers alone, so a recommendation can't reveal why someone
// else wasn't suggested.
// ============================================================

import type { IndustryCategory } from '@/types'
import {
  HABIT_KEYS,
  PLAY_TIMES,
  optionLabel,
  type MatchProfile,
  type PlayTime,
  type PrefSkill,
} from './survey'

/** One member as the rules see them. */
export interface MatchSubject {
  id: string
  firstName: string
  industry: IndustryCategory | null
  valueOffered: string | null
  valueSought: string | null
  hobbies: string | null
  nonprofits: string[]
  handicap: number | null
  lastSignIn: string | null
  match: MatchProfile
}

// ---- Skill level --------------------------------------------

export type HandicapLevel = 'low' | 'mid' | 'high'

/**
 * Where a handicap index sits: low up to 9, mid 10 to 18, high 19 and up.
 * No handicap reads as a new golfer — the people without one are, nearly
 * always, the people who haven't played enough rounds to have one.
 */
export function handicapLevel(handicap: number | null): HandicapLevel {
  if (handicap === null || !Number.isFinite(handicap)) return 'high'
  if (handicap < 10) return 'low'
  if (handicap < 19) return 'mid'
  return 'high'
}

const SKILL_LEVELS: Record<Exclude<PrefSkill, 'any'>, readonly HandicapLevel[]> = {
  excellent: ['low'],
  good:      ['low', 'mid'],
  new:       ['high'],
}

// ---- Filters ------------------------------------------------

/**
 * Whether `candidate` fits `seeker`'s golf preferences — one direction.
 * "No preference" and "No, I don't mind" rule nobody out.
 */
export function fitsPreferences(seeker: MatchSubject, candidate: MatchSubject): boolean {
  const pref = seeker.match
  const them = candidate.match

  // "Prefer not to say" fits only a member with no gender preference.
  if (pref.pref_gender && pref.pref_gender !== 'any' && them.gender !== pref.pref_gender) return false

  if (pref.pref_skill && pref.pref_skill !== 'any'
      && !SKILL_LEVELS[pref.pref_skill].includes(handicapLevel(candidate.handicap))) return false

  if (pref.pref_attitude && pref.pref_attitude !== 'any' && them.attitude !== pref.pref_attitude) return false

  for (const h of HABIT_KEYS) {
    // Only an explicit "No" passes: unanswered can't be checked.
    if (pref[`minds_${h}`] === true && them[`does_${h}`] !== false) return false
  }
  return true
}

/** Both directions: each fits the other's preferences. */
export function mutualFit(a: MatchSubject, b: MatchSubject): boolean {
  return fitsPreferences(a, b) && fitsPreferences(b, a)
}

// ---- Score --------------------------------------------------

/** Out of 100. Tuned by changing these, nothing else. */
export const MATCH_WEIGHTS = {
  business: 40,
  industry: 20,
  play: 20,
  interests: 10,
  active: 10,
} as const

/** Handicaps further apart than this don't count toward play fit. */
export const HANDICAP_GAP = 8

const DAY_MS = 86_400_000

const STOP_WORDS = new Set([
  'with', 'that', 'this', 'from', 'your', 'have', 'they', 'their', 'into', 'more',
  'help', 'helping', 'looking', 'want', 'work', 'working', 'other', 'about', 'also',
  'business', 'businesses', 'people', 'like', 'some', 'them', 'well', 'good', 'great',
])

function words(text: string | null): Set<string> {
  if (!text) return new Set()
  return new Set(
    text.toLowerCase().split(/[^a-z0-9&]+/).filter(w => w.length >= 4 && !STOP_WORDS.has(w)),
  )
}

function sharedCount(a: Set<string>, b: Set<string>): number {
  let n = 0
  for (const w of a) if (b.has(w)) n++
  return n
}

/** B is the kind of client A serves (industry, and size where A said one). */
function servesThem(a: MatchSubject, b: MatchSubject): boolean {
  if (!b.industry || !a.match.client_industries.includes(b.industry)) return false
  const sizes = a.match.client_company_sizes
  return sizes.length === 0 || (b.match.company_size !== null && sizes.includes(b.match.company_size))
}

/** What A wants from connections, and how well B answers it, 0 to 1. */
function businessFit(a: MatchSubject, b: MatchSubject): number {
  const goals = new Set(a.match.goals)
  if (goals.size === 0) return 0
  // Here for the golf: no business ask to meet, so nobody fails it.
  if (goals.size === 1 && goals.has('just_golf')) return 0.5

  const theirs = new Set(b.match.goals)
  let fit = 0
  if (goals.has('new_clients') && servesThem(a, b)) fit = Math.max(fit, 1)
  if (goals.has('get_mentorship') && theirs.has('give_mentorship')) fit = Math.max(fit, 1)
  if (goals.has('give_mentorship') && theirs.has('get_mentorship')) fit = Math.max(fit, 0.8)
  if (goals.has('referral_partners') && theirs.has('referral_partners')) fit = Math.max(fit, 0.8)
  if (goals.has('capital') && b.industry === 'Capital Provider') fit = Math.max(fit, 1)
  if ((goals.has('capital') || goals.has('investment_deals'))
      && (theirs.has('investment_deals') || theirs.has('capital'))) fit = Math.max(fit, 0.7)
  if (goals.has('hiring') && b.industry === 'HR & Recruitment') fit = Math.max(fit, 0.8)
  // What A seeks, in B's own words about what they offer. Three shared terms
  // is as good as a stated goal.
  fit = Math.max(fit, Math.min(1, sharedCount(words(a.valueSought), words(b.valueOffered)) / 3))
  return fit
}

function playFit(a: MatchSubject, b: MatchSubject): number {
  let fit = 0
  if (a.match.play_times.some(t => b.match.play_times.includes(t))) fit += 0.4
  if (a.handicap !== null && b.handicap !== null && Math.abs(a.handicap - b.handicap) <= HANDICAP_GAP) fit += 0.3
  if (a.match.attitude && a.match.attitude === b.match.attitude) fit += 0.3
  return fit
}

function sharedNonprofits(a: MatchSubject, b: MatchSubject): string[] {
  const theirs = new Set(b.nonprofits.map(n => n.trim().toLowerCase()))
  return a.nonprofits.filter(n => theirs.has(n.trim().toLowerCase()))
}

function interestsFit(a: MatchSubject, b: MatchSubject): number {
  if (sharedNonprofits(a, b).length > 0) return 1
  return sharedCount(words(a.hobbies), words(b.hobbies)) > 0 ? 0.5 : 0
}

function activeFit(b: MatchSubject, now: Date): number {
  if (!b.lastSignIn) return 0
  const days = (now.getTime() - new Date(b.lastSignIn).getTime()) / DAY_MS
  if (days <= 14) return 1
  if (days <= 30) return 0.5
  return 0
}

/** A→B: how well B answers what A is after, out of 100. */
export function directionalScore(a: MatchSubject, b: MatchSubject, now: Date): number {
  return (
    MATCH_WEIGHTS.business * businessFit(a, b)
    + MATCH_WEIGHTS.industry * (b.industry && a.match.meet_industries.includes(b.industry) ? 1 : 0)
    + MATCH_WEIGHTS.play * playFit(a, b)
    + MATCH_WEIGHTS.interests * interestsFit(a, b)
    + MATCH_WEIGHTS.active * activeFit(b, now)
  )
}

/**
 * The pair's score, out of 100. The geometric mean of both directions, so a
 * match that only works for one person scores low — it has to work for both.
 */
export function pairScore(a: MatchSubject, b: MatchSubject, now: Date): number {
  return Math.round(Math.sqrt(directionalScore(a, b, now) * directionalScore(b, a, now)))
}

// ---- Words --------------------------------------------------

/** "you both play …" — each play time as it reads in a sentence. */
const PLAY_TIME_PHRASES: Record<PlayTime, string> = {
  weekday_early:     'early on weekdays',
  weekday_midday:    'midday on weekdays',
  weekday_twilight:  'twilight on weekdays',
  weekend_morning:   'weekend mornings',
  weekend_afternoon: 'weekend afternoons',
}

/** "Dana …" — each industry as it reads in a sentence; Other says nothing. */
const INDUSTRY_PHRASES: Record<IndustryCategory, string | null> = {
  'Business Owner / Founder':           'is a founder',
  'Professional Services (Legal)':      'works in legal',
  'Professional Services (Accounting)': 'works in accounting',
  'Professional Services (Consulting)': 'works in consulting',
  'Capital Provider':                   'is a capital provider',
  'Insurance':                          'works in insurance',
  'Business Software':                  'works in business software',
  'Business Services':                  'works in business services',
  'HR & Recruitment':                   'works in HR and recruitment',
  'Real Estate':                        'works in real estate',
  'Healthcare / Life Sciences':         'works in healthcare and life sciences',
  'Financial Services':                 'works in financial services',
  'Technology':                         'works in technology',
  'Other':                              null,
}

function sharedPlayTimes(a: MatchSubject, b: MatchSubject): PlayTime[] {
  return a.match.play_times.filter(t => b.match.play_times.includes(t))
}

/**
 * The reasons behind the score, as short chips for the admin. About B, from
 * A's side: "Potential client" means B is the kind of client A serves.
 */
export function matchChips(a: MatchSubject, b: MatchSubject): string[] {
  const chips: string[] = []
  const goals = new Set(a.match.goals)
  const theirs = new Set(b.match.goals)
  if (goals.has('new_clients') && servesThem(a, b)) chips.push('Potential client')
  if (goals.has('get_mentorship') && theirs.has('give_mentorship')) chips.push('Can mentor')
  if (goals.has('give_mentorship') && theirs.has('get_mentorship')) chips.push('Wants mentoring')
  if (goals.has('referral_partners') && theirs.has('referral_partners')) chips.push('Both want referral partners')
  if (goals.has('capital') && b.industry === 'Capital Provider') chips.push('Capital provider')
  if (goals.has('hiring') && b.industry === 'HR & Recruitment') chips.push('Recruiter')
  if (sharedCount(words(a.valueSought), words(b.valueOffered)) > 0) chips.push('Offers what they seek')
  if (b.industry && a.match.meet_industries.includes(b.industry)) chips.push('Industry they want to meet')
  const time = sharedPlayTimes(a, b)[0]
  if (time) chips.push(`Both ${optionLabel(PLAY_TIMES, time).toLowerCase()}`)
  if (a.match.attitude && a.match.attitude === b.match.attitude) chips.push('Same golf attitude')
  const cause = sharedNonprofits(a, b)[0]
  if (cause) chips.push(`Both support ${cause}`)
  return chips
}

/**
 * What the member sees beside a recommendation: what the two share. Play
 * times and causes only — a handicap is shown only where its owner chose to.
 */
export function sharedChips(a: MatchSubject, b: MatchSubject): string[] {
  const chips = sharedPlayTimes(a, b).slice(0, 2).map(t => `Both ${optionLabel(PLAY_TIMES, t).toLowerCase()}`)
  for (const cause of sharedNonprofits(a, b).slice(0, 2)) chips.push(`Both support ${cause}`)
  return chips
}

/** Maximum length of the note an admin sends with a recommendation. */
export const MAX_NOTE_LENGTH = 280

/**
 * The note an admin's pick is pre-filled with, written to A about B: the two
 * strongest reasons, in a sentence. The admin edits it or sends it as it is.
 */
export function templatedNote(a: MatchSubject, b: MatchSubject): string {
  const name = b.firstName.trim() || 'They'
  const goals = new Set(a.match.goals)
  const theirs = new Set(b.match.goals)
  const industry = b.industry ? INDUSTRY_PHRASES[b.industry] : null
  const clauses: string[] = []

  if (goals.has('get_mentorship') && theirs.has('give_mentorship')) {
    clauses.push(`${name} offers mentorship, and you're looking for a mentor`)
  } else if (goals.has('give_mentorship') && theirs.has('get_mentorship')) {
    clauses.push(`${name} is looking for a mentor, and you offer mentorship`)
  }
  if (goals.has('new_clients') && servesThem(a, b) && industry) {
    clauses.push(`${name} ${industry}, the kind of client you serve`)
  } else if (b.industry && a.match.meet_industries.includes(b.industry) && industry) {
    clauses.push(`${name} ${industry}, the kind of person you want to meet`)
  }
  if (goals.has('referral_partners') && theirs.has('referral_partners')) {
    clauses.push(`you're both looking for referral partners`)
  }
  if (sharedCount(words(a.valueSought), words(b.valueOffered)) >= 2) {
    clauses.push(`${name} offers what you're looking for`)
  }
  const time = sharedPlayTimes(a, b)[0]
  if (time) clauses.push(`you both play ${PLAY_TIME_PHRASES[time]}`)
  const cause = sharedNonprofits(a, b)[0]
  if (cause) clauses.push(`you both support ${cause}`)

  if (clauses.length === 0) return `We think you and ${name} would enjoy a round together.`
  const sentence = clauses.slice(0, 2).join(', and ')
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`
}
