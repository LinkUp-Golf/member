// ============================================================
// Curated Introductions — every question, its options, and the
// one validator both the form and PUT /api/match-survey use.
//
// Optional. A member turns Curated Introductions on from More,
// answers these, and from then on the LinkUp team can introduce
// them to other members and other members to them. Off (or never
// answered) means neither. Pure, so the form can import it.
//
// Two kinds of answer live here:
//   * About the member — their business, their golf, their gender
//     and habits. Other members' preferences are checked against
//     these.
//   * Preferences — who the member would like to be introduced to
//     (Step 1: objectives, industries, roles, company size; these
//     rank) and who they would or would not like to play with
//     (Preferred introductions; these filter — see ./rules.ts).
//
// What they offer and seek is stored on member_profiles, where the
// profile page already edits it; the survey pre-fills and saves it
// there.
// ============================================================

export interface Option<V extends string = string> {
  value: V
  label: string
}

// ---- Curated Introduction Preferences -----------------------

/**
 * What the member wants from connections. The stored values predate the
 * labels: "Mentors" is the member looking for a mentor (get_mentorship), and
 * "Mentees" the member looking for someone to mentor (give_mentorship) — so an
 * answer given under the old wording keeps its meaning.
 */
export const MATCH_GOALS = [
  { value: 'new_clients',       label: 'New clients' },
  { value: 'referral_partners', label: 'Referral partners' },
  { value: 'capital',           label: 'Capital' },
  { value: 'investment_deals',  label: 'Investment deals' },
  { value: 'hiring',            label: 'Team Members' },
  { value: 'vendors',           label: 'Vendors' },
  { value: 'get_mentorship',    label: 'Mentors' },
  { value: 'give_mentorship',   label: 'Mentees' },
  { value: 'just_golf',         label: 'Just golf' },
] as const satisfies readonly Option[]
export type MatchGoal = (typeof MATCH_GOALS)[number]['value']
export const MAX_GOALS = 3

/**
 * The survey's industries: the app's list without "Business Owner / Founder"
 * (a role — see ROLES) and with "Non-profit" in place of "Other". Values are
 * the labels, as the app's industry list stores them.
 */
export const SURVEY_INDUSTRIES = [
  'Professional Services (Legal)',
  'Professional Services (Accounting)',
  'Professional Services (Consulting)',
  'Capital Provider',
  'Insurance',
  'Business Software',
  'Business Services',
  'HR & Recruitment',
  'Real Estate',
  'Healthcare / Life Sciences',
  'Financial Services',
  'Technology',
  'Non-profit',
] as const
export type SurveyIndustry = (typeof SURVEY_INDUSTRIES)[number]
export const INDUSTRY_OPTIONS: readonly Option<SurveyIndustry>[] = SURVEY_INDUSTRIES.map(i => ({ value: i, label: i }))

export const ROLES = [
  { value: 'founder',     label: 'Founder / Owner / CEO' },
  { value: 'finance',     label: 'Finance' },
  { value: 'marketing',   label: 'Marketing' },
  { value: 'operations',  label: 'Operations' },
  { value: 'development', label: 'Development' },
  { value: 'it',          label: 'IT' },
  { value: 'hr',          label: 'HR' },
  { value: 'sales',       label: 'Sales' },
  { value: 'legal',       label: 'Legal' },
] as const satisfies readonly Option[]
export type Role = (typeof ROLES)[number]['value']

/** The company size a member would like to be introduced to. */
export const PREF_COMPANY_SIZES = [
  { value: '1_10',     label: '1-10' },
  { value: '11_50',    label: '11-50' },
  { value: '51_200',   label: '51-200' },
  { value: '201_1000', label: '201-1000' },
  { value: '1000_up',  label: '1000+' },
  { value: 'any',      label: 'Any size' },
] as const satisfies readonly Option[]
export type PrefCompanySize = (typeof PREF_COMPANY_SIZES)[number]['value']

// ---- Describe your business ---------------------------------

export const COMPANY_SIZES = [
  { value: 'solo',     label: 'Solopreneurs' },
  { value: '2_10',     label: '2–10 people' },
  { value: '11_50',    label: '11–50 people' },
  { value: '51_200',   label: '51–200 people' },
  { value: '201_1000', label: '201–1,000 people' },
  { value: '1000_up',  label: 'More than 1,000' },
] as const satisfies readonly Option[]
export type CompanySize = (typeof COMPANY_SIZES)[number]['value']

/** Which ideal-size choice a company of this size falls in. */
export const SIZE_BUCKET: Record<CompanySize, Exclude<PrefCompanySize, 'any'>> = {
  solo:     '1_10',
  '2_10':   '1_10',
  '11_50':  '11_50',
  '51_200': '51_200',
  '201_1000': '201_1000',
  '1000_up':  '1000_up',
}

// ---- Describe yourself as a golfer --------------------------

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

/**
 * The member's own skill, the client's wording. Same values as the skill
 * preference, so "Good golfers only" reads straight off this answer.
 */
export const SKILLS = [
  { value: 'excellent', label: 'Excellent golfer - Low handicap golfers only' },
  { value: 'good',      label: 'Good golfer - Mid to low handicap golfers only' },
  { value: 'new',       label: 'New golfer - Beginners or high handicap golfers only' },
] as const satisfies readonly Option[]
export type Skill = (typeof SKILLS)[number]['value']

// ---- About you ----------------------------------------------

/** Optional: not answering is how a member keeps it to themselves. */
export const GENDERS = [
  { value: 'male',   label: 'Male' },
  { value: 'female', label: 'Female' },
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

// ---- Preferred introductions --------------------------------

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
  meet_industries: SurveyIndustry[]
  meet_roles: Role[]
  meet_company_sizes: PrefCompanySize[]
  company_size: CompanySize | null
  industry: SurveyIndustry | null
  role: Role | null
  client_company_sizes: CompanySize[]
  play_times: PlayTime[]
  attitude: Attitude | null
  skill: Skill | null
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
  /** Curated Introductions is on. */
  open_to_suggestions: boolean
  completed_at: string | null
}

/** The member_profiles fields the survey also asks, pre-filled. */
export interface SurveyProfileFields {
  value_offered: string | null
  value_sought: string | null
}

/** What the form sends: every answer, the profile half included. */
export type SurveyAnswers = Omit<MatchProfile, 'completed_at'> & SurveyProfileFields

export const EMPTY_MATCH_PROFILE: MatchProfile = {
  goals: [],
  meet_industries: [],
  meet_roles: [],
  meet_company_sizes: [],
  company_size: null,
  industry: null,
  role: null,
  client_company_sizes: [],
  play_times: [],
  attitude: null,
  skill: null,
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
  // Off until the member saves the survey: there's no row before that.
  open_to_suggestions: false,
  completed_at: null,
}

/** Reads a stored row into the app's shape; unknown values fall away. */
export function toMatchProfile(row: Partial<Record<keyof MatchProfile, unknown>> | null | undefined): MatchProfile {
  if (!row) return { ...EMPTY_MATCH_PROFILE }
  const p = { ...EMPTY_MATCH_PROFILE }
  p.goals = pickMany(row.goals, MATCH_GOALS)
  p.meet_industries = pickMany(row.meet_industries, INDUSTRY_OPTIONS)
  p.meet_roles = pickMany(row.meet_roles, ROLES)
  p.meet_company_sizes = normaliseSizes(pickMany(row.meet_company_sizes, PREF_COMPANY_SIZES))
  p.company_size = pickOne(row.company_size, COMPANY_SIZES)
  p.industry = pickOne(row.industry, INDUSTRY_OPTIONS)
  p.role = pickOne(row.role, ROLES)
  p.client_company_sizes = pickMany(row.client_company_sizes, COMPANY_SIZES)
  p.play_times = pickMany(row.play_times, PLAY_TIMES)
  p.attitude = pickOne(row.attitude, ATTITUDES)
  p.skill = pickOne(row.skill, SKILLS)
  p.gender = pickOne(row.gender, GENDERS)
  p.pref_gender = pickOne(row.pref_gender, PREF_GENDERS)
  p.pref_skill = pickOne(row.pref_skill, PREF_SKILLS)
  p.pref_attitude = pickOne(row.pref_attitude, PREF_ATTITUDES)
  for (const h of HABIT_KEYS) {
    p[`does_${h}`] = typeof row[`does_${h}`] === 'boolean' ? (row[`does_${h}`] as boolean) : null
    p[`minds_${h}`] = typeof row[`minds_${h}`] === 'boolean' ? (row[`minds_${h}`] as boolean) : null
  }
  // A stored row reads as on unless it says otherwise (the column's default).
  p.open_to_suggestions = row.open_to_suggestions !== false
  p.completed_at = typeof row.completed_at === 'string' ? row.completed_at : null
  return p
}

/** "Any size" stands alone: picked beside a size, it means any. */
export function normaliseSizes(sizes: PrefCompanySize[]): PrefCompanySize[] {
  return sizes.includes('any') ? ['any'] : sizes
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
 * Checks a whole submission. Optional: preferred industries and roles (blank
 * means any), the member's own industry and role, the sizes they serve, their
 * gender, and the free text. Everything else is required, because a
 * preference can only be checked against an answer.
 */
export function validateSurvey(body: unknown): SurveyValidation {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const errors: string[] = []

  const goals = strictMany(b.goals, MATCH_GOALS)
  if (!goals || goals.length === 0) errors.push('Choose at least one objective')
  else if (goals.length > MAX_GOALS) errors.push(`Choose up to ${MAX_GOALS} objectives`)

  const meetIndustries = strictMany(b.meet_industries ?? [], INDUSTRY_OPTIONS)
  if (!meetIndustries) errors.push('Your preferred industries contain one we don\'t recognise')
  const meetRoles = strictMany(b.meet_roles ?? [], ROLES)
  if (!meetRoles) errors.push('Your preferred roles contain one we don\'t recognise')
  const meetSizes = strictMany(b.meet_company_sizes, PREF_COMPANY_SIZES)
  if (!meetSizes || meetSizes.length === 0) errors.push('Choose an ideal company size, or Any size')

  const companySize = pickOne(b.company_size, COMPANY_SIZES)
  if (!companySize) errors.push('Choose your organization size')
  const industry = optionalOne(b.industry, INDUSTRY_OPTIONS)
  if (industry === undefined) errors.push('Choose your industry from the list')
  const role = optionalOne(b.role, ROLES)
  if (role === undefined) errors.push('Choose your role from the list')
  const clientSizes = strictMany(b.client_company_sizes ?? [], COMPANY_SIZES)
  if (!clientSizes) errors.push('The organization sizes you serve contain one we don\'t recognise')

  const playTimes = strictMany(b.play_times, PLAY_TIMES)
  if (!playTimes || playTimes.length === 0) errors.push('Choose when you prefer to play')
  const attitude = pickOne(b.attitude, ATTITUDES)
  if (!attitude) errors.push('Choose your golf attitude')
  const skill = pickOne(b.skill, SKILLS)
  if (!skill) errors.push('Choose your golf skill')

  const gender = optionalOne(b.gender, GENDERS)
  if (gender === undefined) errors.push('Choose Male or Female, or leave your gender blank')

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
  if (offered === undefined || sought === undefined) {
    errors.push(`Keep each answer under ${MAX_SURVEY_TEXT} characters`)
  }

  if (errors.length > 0) return { valid: false, errors }

  return {
    valid: true,
    errors: [],
    // Every `?? …` below is for the type checker: a missing value already
    // returned an error above.
    match: {
      goals: goals ?? [],
      meet_industries: meetIndustries ?? [],
      meet_roles: meetRoles ?? [],
      meet_company_sizes: normaliseSizes(meetSizes ?? []),
      company_size: companySize,
      industry: industry ?? null,
      role: role ?? null,
      client_company_sizes: clientSizes ?? [],
      play_times: playTimes ?? [],
      attitude,
      skill,
      gender: gender ?? null,
      pref_gender: prefGender,
      pref_skill: prefSkill,
      pref_attitude: prefAttitude,
      ...habits,
      // Saving the survey is turning Curated Introductions on, unless the
      // request says otherwise.
      open_to_suggestions: b.open_to_suggestions !== false,
    },
    profile: {
      value_offered: offered ?? null,
      value_sought: sought ?? null,
    },
  }
}

/**
 * Who can use Curated Introductions: a member of a club. A non-member guest, a
 * referral partner or host with no golf membership, and an admin account with
 * no membership of its own are never in the pool, so offering it to them would
 * be a switch with nothing behind it.
 */
export function eligibleForIntroductions(member: {
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

/** null when blank, undefined when it's something that isn't an option. */
function optionalOne<O extends readonly Option[]>(value: unknown, options: O): O[number]['value'] | null | undefined {
  if (value === null || value === undefined || value === '') return null
  return pickOne(value, options) ?? undefined
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

/** Trimmed text, null when blank, undefined when too long or not text. */
function optionalText(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return undefined
  const t = value.trim()
  if (t.length > MAX_SURVEY_TEXT) return undefined
  return t || null
}
