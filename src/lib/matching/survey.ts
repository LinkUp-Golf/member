// ============================================================
// The matching survey — every question, its options, and the one
// validator both the form and PUT /api/match-survey use.
//
// Mandatory: a member can't use the app until it's submitted
// (MatchSurveyGate), because the admin's candidate list is built
// from these answers and a preference nobody stated can't be
// honoured. Pure, so the form can import it.
//
// Two kinds of answer live here:
//   * About the member — goals, industries, play times, attitude,
//     gender and habits. Other members' preferences are checked
//     against these.
//   * Golf preferences — who the member would or would not like to
//     play with. Filters, never weights (src/lib/matching/rules.ts).
//
// The free-text answers (what they offer and seek, hobbies,
// non-profits, handicap) are stored on member_profiles, where the
// profile page already edits them; the survey pre-fills and saves
// them there.
// ============================================================

import { INDUSTRY_CATEGORIES, type IndustryCategory } from '@/types'
import { parseNonprofits, MAX_NONPROFITS } from '@/lib/profile/nonprofits'

export interface Option<V extends string = string> {
  value: V
  label: string
}

// ---- Networking profile -------------------------------------

export const MATCH_GOALS = [
  { value: 'new_clients',       label: 'New clients' },
  { value: 'referral_partners', label: 'Referral partners' },
  { value: 'capital',           label: 'Capital' },
  { value: 'investment_deals',  label: 'Investment deals' },
  { value: 'hiring',            label: 'Hiring' },
  { value: 'vendors',           label: 'Vendors' },
  { value: 'give_mentorship',   label: 'Give mentorship' },
  { value: 'get_mentorship',    label: 'Get mentorship' },
  { value: 'just_golf',         label: 'Just golf' },
] as const satisfies readonly Option[]
export type MatchGoal = (typeof MATCH_GOALS)[number]['value']
export const MAX_GOALS = 3

export const COMPANY_SIZES = [
  { value: 'solo',     label: 'Just me' },
  { value: '2_10',     label: '2–10 people' },
  { value: '11_50',    label: '11–50 people' },
  { value: '51_200',   label: '51–200 people' },
  { value: '201_1000', label: '201–1,000 people' },
  { value: '1000_up',  label: 'More than 1,000' },
] as const satisfies readonly Option[]
export type CompanySize = (typeof COMPANY_SIZES)[number]['value']

export const PLAY_TIMES = [
  { value: 'weekday_early',     label: 'Weekday early' },
  { value: 'weekday_midday',    label: 'Weekday midday' },
  { value: 'weekday_twilight',  label: 'Weekday twilight' },
  { value: 'weekend_morning',   label: 'Weekend morning' },
  { value: 'weekend_afternoon', label: 'Weekend afternoon' },
] as const satisfies readonly Option[]
export type PlayTime = (typeof PLAY_TIMES)[number]['value']

/**
 * The member's own attitude. Worded exactly as the preference's options, so
 * the two compare one to one — a preference only works against an answer in
 * the same terms.
 */
export const ATTITUDES = [
  { value: 'serious',  label: 'Serious, competitive, strict adherence to rules of golf' },
  { value: 'friendly', label: 'Friendly competition' },
  { value: 'relaxed',  label: 'Relaxed, casual, "Not Attached to the Outcome". Score keeping optional' },
] as const satisfies readonly Option[]
export type Attitude = (typeof ATTITUDES)[number]['value']

// ---- About the member ---------------------------------------

export const GENDERS = [
  { value: 'male',        label: 'Male' },
  { value: 'female',      label: 'Female' },
  { value: 'undisclosed', label: 'Prefer not to say' },
] as const satisfies readonly Option[]
export type Gender = (typeof GENDERS)[number]['value']

/**
 * The five "Smoke, music and booze" questions. Each is asked twice: once as a
 * preference (minds_*), once about the member (does_*), because a preference
 * can only rule someone out by what that someone said about themselves.
 */
export const HABITS = [
  {
    key: 'cigars',
    minds: 'Do you mind playing with people who smoke cigars?',
    does:  'Do you smoke cigars on the course?',
  },
  {
    key: 'cigarettes',
    minds: 'Do you mind playing with people who smoke cigarettes?',
    does:  'Do you smoke cigarettes on the course?',
  },
  {
    key: 'marijuana',
    minds: 'Do you mind playing with people who smoke marijuana?',
    does:  'Do you smoke marijuana on the course?',
  },
  {
    key: 'alcohol',
    minds: 'Do you mind playing with people who drink alcohol?',
    does:  'Do you drink alcohol on the course?',
  },
  {
    key: 'music',
    minds: 'Do you mind playing with music playing from speakers?',
    does:  'Do you play music from a speaker on the course?',
  },
] as const
export type Habit = (typeof HABITS)[number]['key']
export const HABIT_KEYS: readonly Habit[] = HABITS.map(h => h.key)

// ---- Golf preferences ---------------------------------------

export const GOLF_PREFERENCES_PROMPT =
  'Describe the profile of person you would or would not like to play golf with'

export const PREF_GENDERS = [
  { value: 'male',   label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'any',    label: 'No preference' },
] as const satisfies readonly Option[]
export type PrefGender = (typeof PREF_GENDERS)[number]['value']

export const PREF_SKILLS = [
  { value: 'excellent', label: 'Excellent golfers - Low handicap golfers only' },
  { value: 'good',      label: 'Good golfers - Mid to low handicap golfers only' },
  { value: 'new',       label: 'New golfers - Beginners or high handicap golfers only' },
  { value: 'any',       label: 'No preference' },
] as const satisfies readonly Option[]
export type PrefSkill = (typeof PREF_SKILLS)[number]['value']

export const PREF_ATTITUDES = [
  ...ATTITUDES,
  { value: 'any', label: 'No preference' },
] as const satisfies readonly Option[]
export type PrefAttitude = (typeof PREF_ATTITUDES)[number]['value']

// ---- The stored shape ---------------------------------------

/** A member_match_profiles row, as the app reads and writes it. */
export interface MatchProfile {
  goals: MatchGoal[]
  meet_industries: IndustryCategory[]
  client_industries: IndustryCategory[]
  client_company_sizes: CompanySize[]
  company_size: CompanySize | null
  play_times: PlayTime[]
  attitude: Attitude | null
  gender: Gender | null
  does_cigars: boolean | null
  does_cigarettes: boolean | null
  does_marijuana: boolean | null
  does_alcohol: boolean | null
  does_music: boolean | null
  pref_gender: PrefGender | null
  pref_skill: PrefSkill | null
  pref_attitude: PrefAttitude | null
  minds_cigars: boolean | null
  minds_cigarettes: boolean | null
  minds_marijuana: boolean | null
  minds_alcohol: boolean | null
  minds_music: boolean | null
  open_to_suggestions: boolean
  completed_at: string | null
}

/** The member_profiles fields the survey also asks, pre-filled. */
export interface SurveyProfileFields {
  value_offered: string | null
  value_sought: string | null
  handicap_index: number | null
  non_golf_hobbies: string | null
  nonprofits: string[]
}

/** What the form sends: every answer, the profile half included. */
export type SurveyAnswers = Omit<MatchProfile, 'completed_at'> & SurveyProfileFields

export const EMPTY_MATCH_PROFILE: MatchProfile = {
  goals: [],
  meet_industries: [],
  client_industries: [],
  client_company_sizes: [],
  company_size: null,
  play_times: [],
  attitude: null,
  gender: null,
  does_cigars: null,
  does_cigarettes: null,
  does_marijuana: null,
  does_alcohol: null,
  does_music: null,
  pref_gender: null,
  pref_skill: null,
  pref_attitude: null,
  minds_cigars: null,
  minds_cigarettes: null,
  minds_marijuana: null,
  minds_alcohol: null,
  minds_music: null,
  open_to_suggestions: true,
  completed_at: null,
}

/** Reads a stored row into the app's shape; unknown values fall away. */
export function toMatchProfile(row: Partial<Record<keyof MatchProfile, unknown>> | null | undefined): MatchProfile {
  if (!row) return { ...EMPTY_MATCH_PROFILE }
  const p = { ...EMPTY_MATCH_PROFILE }
  p.goals = pickMany(row.goals, MATCH_GOALS)
  p.meet_industries = pickIndustries(row.meet_industries)
  p.client_industries = pickIndustries(row.client_industries)
  p.client_company_sizes = pickMany(row.client_company_sizes, COMPANY_SIZES)
  p.company_size = pickOne(row.company_size, COMPANY_SIZES)
  p.play_times = pickMany(row.play_times, PLAY_TIMES)
  p.attitude = pickOne(row.attitude, ATTITUDES)
  p.gender = pickOne(row.gender, GENDERS)
  p.pref_gender = pickOne(row.pref_gender, PREF_GENDERS)
  p.pref_skill = pickOne(row.pref_skill, PREF_SKILLS)
  p.pref_attitude = pickOne(row.pref_attitude, PREF_ATTITUDES)
  for (const h of HABIT_KEYS) {
    p[`does_${h}`] = typeof row[`does_${h}`] === 'boolean' ? (row[`does_${h}`] as boolean) : null
    p[`minds_${h}`] = typeof row[`minds_${h}`] === 'boolean' ? (row[`minds_${h}`] as boolean) : null
  }
  p.open_to_suggestions = row.open_to_suggestions !== false
  p.completed_at = typeof row.completed_at === 'string' ? row.completed_at : null
  return p
}

// ---- Validation ---------------------------------------------

export const MAX_SURVEY_TEXT = 1000

export interface SurveyValidation {
  valid: boolean
  errors: string[]
  /** The member_match_profiles columns to write, when valid. */
  match?: Omit<MatchProfile, 'completed_at'>
  /** The member_profiles columns to write, when valid. */
  profile?: SurveyProfileFields
}

/**
 * Checks a whole submission. Every pick-list is required; the free text,
 * the handicap and the "who are your best clients" pair are not — a new
 * golfer may have no handicap, and not every member sells to anyone.
 */
export function validateSurvey(body: unknown): SurveyValidation {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const errors: string[] = []

  const goals = strictMany(b.goals, MATCH_GOALS)
  if (!goals || goals.length === 0) errors.push('Choose what you want from LinkUp connections')
  else if (goals.length > MAX_GOALS) errors.push(`Choose up to ${MAX_GOALS} things you want from LinkUp connections`)

  const meet = strictIndustries(b.meet_industries)
  if (!meet || meet.length === 0) errors.push('Choose at least one industry you would like to meet')

  const clientIndustries = strictIndustries(b.client_industries ?? [])
  if (!clientIndustries) errors.push('Your best clients contain an industry we don\'t recognise')
  const clientSizes = strictMany(b.client_company_sizes ?? [], COMPANY_SIZES)
  if (!clientSizes) errors.push('Your best clients contain a company size we don\'t recognise')

  const companySize = pickOne(b.company_size, COMPANY_SIZES)
  if (!companySize) errors.push('Choose your company size')

  const playTimes = strictMany(b.play_times, PLAY_TIMES)
  if (!playTimes || playTimes.length === 0) errors.push('Choose when you usually play')

  const attitude = pickOne(b.attitude, ATTITUDES)
  if (!attitude) errors.push('Choose your golf attitude')

  const gender = pickOne(b.gender, GENDERS)
  if (!gender) errors.push('Choose your gender, or Prefer not to say')

  const prefGender = pickOne(b.pref_gender, PREF_GENDERS)
  if (!prefGender) errors.push('Answer "Do you have a gender preference"')
  const prefSkill = pickOne(b.pref_skill, PREF_SKILLS)
  if (!prefSkill) errors.push('Answer "Do you have a skill level preference"')
  const prefAttitude = pickOne(b.pref_attitude, PREF_ATTITUDES)
  if (!prefAttitude) errors.push('Answer "Do you have a golf attitude preference"')

  // Unanswered reads as null, and null is an error here — only the stored
  // shape allows it, for a survey not yet taken.
  const yesNo = (key: `does_${Habit}` | `minds_${Habit}`, question: string): boolean | null => {
    const v = b[key]
    if (typeof v === 'boolean') return v
    errors.push(`Answer "${question}"`)
    return null
  }
  const habits = {} as Record<`does_${Habit}` | `minds_${Habit}`, boolean | null>
  for (const h of HABITS) {
    habits[`does_${h.key}`] = yesNo(`does_${h.key}`, h.does)
    habits[`minds_${h.key}`] = yesNo(`minds_${h.key}`, h.minds)
  }

  const offered = optionalText(b.value_offered)
  const sought = optionalText(b.value_sought)
  const hobbies = optionalText(b.non_golf_hobbies)
  if (offered === undefined || sought === undefined || hobbies === undefined) {
    errors.push(`Keep each answer under ${MAX_SURVEY_TEXT} characters`)
  }

  const handicap = parseHandicap(b.handicap_index)
  if (handicap === undefined) errors.push('Handicap must be a number between -10 and 54')

  const nonprofits = parseNonprofits((b.nonprofits ?? null) as string | string[] | null)
  if (nonprofits.length > MAX_NONPROFITS) errors.push(`List up to ${MAX_NONPROFITS} non-profits`)

  if (errors.length > 0) return { valid: false, errors }

  return {
    valid: true,
    errors: [],
    // Every `?? …` below is for the type checker: a missing value already
    // returned an error above.
    match: {
      goals: goals ?? [],
      meet_industries: meet ?? [],
      client_industries: clientIndustries ?? [],
      client_company_sizes: clientSizes ?? [],
      company_size: companySize,
      play_times: playTimes ?? [],
      attitude,
      gender,
      pref_gender: prefGender,
      pref_skill: prefSkill,
      pref_attitude: prefAttitude,
      ...habits,
      // Absent means yes: the toggle is shown on, and turning it off is the
      // deliberate act.
      open_to_suggestions: b.open_to_suggestions !== false,
    },
    profile: {
      value_offered: offered ?? null,
      value_sought: sought ?? null,
      handicap_index: handicap ?? null,
      non_golf_hobbies: hobbies ?? null,
      nonprofits,
    },
  }
}

/**
 * Who has to complete the survey: a member of a club. A non-member guest, a
 * referral partner or host with no golf membership, and an admin account with
 * no membership of its own are never in the pool, so asking them would be a
 * wall with nothing behind it.
 */
export function requiresMatchSurvey(member: {
  home_course_id: string | null
  membership_status: string
  hasMembership: boolean
}): boolean {
  return Boolean(member.home_course_id) && member.membership_status === 'active' && member.hasMembership
}

/** The label for a stored value, or the value itself if it's unknown. */
export function optionLabel(options: readonly Option[], value: string | null | undefined): string {
  if (!value) return ''
  return options.find(o => o.value === value)?.label ?? value
}

// ---- helpers ------------------------------------------------

function pickOne<O extends readonly Option[]>(value: unknown, options: O): O[number]['value'] | null {
  return typeof value === 'string' && options.some(o => o.value === value) ? (value as O[number]['value']) : null
}

function pickMany<O extends readonly Option[]>(value: unknown, options: O): O[number]['value'][] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.filter((v): v is O[number]['value'] => pickOne(v, options) !== null)))
}

/** Like pickMany, but null when anything in the list isn't an option. */
function strictMany<O extends readonly Option[]>(value: unknown, options: O): O[number]['value'][] | null {
  if (!Array.isArray(value)) return null
  if (value.some(v => pickOne(v, options) === null)) return null
  return Array.from(new Set(value as O[number]['value'][]))
}

function pickIndustries(value: unknown): IndustryCategory[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.filter((v): v is IndustryCategory =>
    typeof v === 'string' && (INDUSTRY_CATEGORIES as string[]).includes(v))))
}

function strictIndustries(value: unknown): IndustryCategory[] | null {
  if (!Array.isArray(value)) return null
  if (value.some(v => typeof v !== 'string' || !(INDUSTRY_CATEGORIES as string[]).includes(v))) return null
  return Array.from(new Set(value as IndustryCategory[]))
}

/** Trimmed text, null when blank, undefined when too long or not text. */
function optionalText(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return undefined
  const t = value.trim()
  if (t.length > MAX_SURVEY_TEXT) return undefined
  return t || null
}

/** A handicap index, null when blank, undefined when it isn't one. */
function parseHandicap(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'string' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isFinite(n) || n < -10 || n > 54) return undefined
  return Math.round(n * 10) / 10
}
