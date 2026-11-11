import { describe, it, expect } from 'vitest'
import {
  fitsPreferences,
  matchChips,
  mutualFit,
  pairScore,
  sharedChips,
  skillFromHandicap,
  skillOf,
  templatedNote,
  type MatchSubject,
} from '@/lib/matching/rules'
import {
  EMPTY_MATCH_PROFILE,
  HABITS,
  MATCH_GOALS,
  eligibleForIntroductions,
  optionLabel,
  toMatchProfile,
  validateSurvey,
  type MatchProfile,
} from '@/lib/matching/survey'

const NOW = new Date('2026-11-04T12:00:00Z')

/** A member who answered everything, has no preferences and does none of the five. */
function subject(id: string, overrides: Partial<Omit<MatchSubject, 'match'>> = {}, match: Partial<MatchProfile> = {}): MatchSubject {
  return {
    id,
    firstName: id.charAt(0).toUpperCase() + id.slice(1),
    industry: 'Technology',
    role: null,
    valueOffered: null,
    valueSought: null,
    hobbies: null,
    nonprofits: [],
    handicap: 14,
    lastSignIn: '2026-11-01T00:00:00Z',
    ...overrides,
    match: {
      ...EMPTY_MATCH_PROFILE,
      goals: ['just_golf'],
      meet_industries: [],
      meet_roles: [],
      meet_company_sizes: ['any'],
      company_size: '2_10',
      play_times: ['weekday_early'],
      attitude: 'friendly',
      skill: 'good',
      gender: 'female',
      does_cigars: false,
      does_cigarettes: false,
      does_marijuana: false,
      does_alcohol: false,
      does_music: false,
      pref_gender: 'any',
      pref_skill: 'any',
      pref_attitude: 'any',
      minds_cigars: false,
      minds_cigarettes: false,
      minds_marijuana: false,
      minds_alcohol: false,
      minds_music: false,
      open_to_suggestions: true,
      completed_at: '2026-11-01T00:00:00Z',
      ...match,
    },
  }
}

describe('objectives', () => {
  it('labels the old mentorship values by who the member is looking for', () => {
    expect(optionLabel(MATCH_GOALS, 'hiring')).toBe('Team Members')
    expect(optionLabel(MATCH_GOALS, 'get_mentorship')).toBe('Mentors')
    expect(optionLabel(MATCH_GOALS, 'give_mentorship')).toBe('Mentees')
  })
})

describe('skill', () => {
  it('reads a handicap as a skill for members who answered before the question existed', () => {
    expect(skillFromHandicap(2.4)).toBe('excellent')
    expect(skillFromHandicap(9.9)).toBe('excellent')
    expect(skillFromHandicap(10)).toBe('good')
    expect(skillFromHandicap(18.9)).toBe('good')
    expect(skillFromHandicap(19)).toBe('new')
    expect(skillFromHandicap(null)).toBe('new')
  })

  it('prefers what the member said over their handicap', () => {
    expect(skillOf(subject('a', { handicap: 4 }, { skill: 'new' }))).toBe('new')
    expect(skillOf(subject('a', { handicap: 4 }, { skill: null }))).toBe('excellent')
  })
})

describe('fitsPreferences', () => {
  const sam = subject('sam')

  it('lets everyone through when there are no preferences', () => {
    expect(fitsPreferences(sam, subject('dana'))).toBe(true)
  })

  it('applies a gender preference, and a blank gender only fits no preference', () => {
    const wantsMale = subject('sam', {}, { pref_gender: 'male' })
    expect(fitsPreferences(wantsMale, subject('dana', {}, { gender: 'female' }))).toBe(false)
    expect(fitsPreferences(wantsMale, subject('marcus', {}, { gender: 'male' }))).toBe(true)
    expect(fitsPreferences(wantsMale, subject('ali', {}, { gender: null }))).toBe(false)
    expect(fitsPreferences(sam, subject('ali', {}, { gender: null }))).toBe(true)
  })

  it('checks a skill preference against each golfer’s own skill', () => {
    const excellent = subject('sam', {}, { pref_skill: 'excellent' })
    const good = subject('sam', {}, { pref_skill: 'good' })
    const newer = subject('sam', {}, { pref_skill: 'new' })
    const ace = subject('a', {}, { skill: 'excellent' })
    const mid = subject('b', {}, { skill: 'good' })
    const fresh = subject('c', {}, { skill: 'new' })
    expect([ace, mid, fresh].map(c => fitsPreferences(excellent, c))).toEqual([true, false, false])
    expect([ace, mid, fresh].map(c => fitsPreferences(good, c))).toEqual([true, true, false])
    expect([ace, mid, fresh].map(c => fitsPreferences(newer, c))).toEqual([false, false, true])
  })

  it("compares an attitude preference with the candidate's own attitude", () => {
    const serious = subject('sam', {}, { pref_attitude: 'serious' })
    expect(fitsPreferences(serious, subject('dana', {}, { attitude: 'serious' }))).toBe(true)
    expect(fitsPreferences(serious, subject('dana', {}, { attitude: 'relaxed' }))).toBe(false)
  })

  it('leaves out a candidate who does what the member minds, or never said', () => {
    for (const h of HABITS) {
      const minds = subject('sam', {}, { [`minds_${h.key}`]: true })
      expect(fitsPreferences(minds, subject('dana', {}, { [`does_${h.key}`]: false }))).toBe(true)
      expect(fitsPreferences(minds, subject('dana', {}, { [`does_${h.key}`]: true }))).toBe(false)
      expect(fitsPreferences(minds, subject('dana', {}, { [`does_${h.key}`]: null }))).toBe(false)
    }
  })
})

describe('mutualFit', () => {
  it('needs each to fit the other', () => {
    const sam = subject('sam', {}, { does_cigars: true })
    const dana = subject('dana', {}, { minds_cigars: true })
    expect(fitsPreferences(sam, dana)).toBe(true)
    expect(fitsPreferences(dana, sam)).toBe(false)
    expect(mutualFit(sam, dana)).toBe(false)
    expect(mutualFit(dana, sam)).toBe(false)
  })
})

describe('pairScore', () => {
  const sam = subject('sam', { industry: 'Professional Services (Accounting)', valueSought: 'referral partners in wealth management' }, {
    goals: ['new_clients', 'referral_partners'],
    meet_industries: ['Financial Services'],
    client_company_sizes: ['2_10'],
  })

  it('ranks a strong two-way fit above a weak one', () => {
    const dana = subject('dana', { industry: 'Financial Services', valueOffered: 'wealth management for founders' }, {
      goals: ['referral_partners'],
      meet_industries: ['Professional Services (Accounting)'],
    })
    const quiet = subject('quiet', { industry: 'Non-profit', lastSignIn: null }, {
      play_times: ['weekend_afternoon'], attitude: 'serious', skill: 'new', company_size: '1000_up',
    })
    expect(pairScore(sam, dana, NOW)).toBeGreaterThan(pairScore(sam, quiet, NOW))
  })

  it('ranks the roles and company size a member wants to meet higher', () => {
    const wantsFounders = subject('sam', {}, { meet_roles: ['founder'], meet_company_sizes: ['11_50'] })
    const founder = subject('dana', { role: 'founder' }, { company_size: '11_50' })
    const other = subject('lee', { role: 'sales' }, { company_size: '1000_up' })
    expect(pairScore(wantsFounders, founder, NOW)).toBeGreaterThan(pairScore(wantsFounders, other, NOW))
  })

  it('counts a Solopreneur and a 2–10 company as 1-10', () => {
    const wantsSmall = subject('sam', {}, { meet_company_sizes: ['1_10'] })
    const solo = subject('dana', {}, { company_size: 'solo' })
    const big = subject('lee', {}, { company_size: '51_200' })
    expect(matchChips(wantsSmall, solo)).toContain('Company size they want')
    expect(matchChips(wantsSmall, big)).not.toContain('Company size they want')
  })

  it('is symmetric and stays within 0 to 100', () => {
    const dana = subject('dana', { role: 'founder' }, { goals: ['new_clients'] })
    const ab = pairScore(sam, dana, NOW)
    expect(ab).toBe(pairScore(dana, sam, NOW))
    expect(ab).toBeGreaterThanOrEqual(0)
    expect(ab).toBeLessThanOrEqual(100)
  })
})

describe('chips and notes', () => {
  const sam = subject('sam', { nonprofits: ['St. Jude'] }, {
    goals: ['new_clients'],
    client_company_sizes: ['2_10'],
    minds_cigars: true,
    pref_gender: 'female',
  })
  const dana = subject('dana', { industry: null, role: 'founder', nonprofits: ['st. jude'] }, { gender: 'female' })

  it('writes the note from the business and golf answers', () => {
    expect(templatedNote(sam, dana)).toBe('Dana is a founder, the kind of client you serve, and you both play early on weekdays.')
  })

  it('names the role a member asked to meet', () => {
    const wantsFounders = subject('sam', {}, { meet_roles: ['founder'], play_times: ['weekend_morning'] })
    expect(templatedNote(wantsFounders, dana)).toBe('Dana is a founder, the kind of person you want to meet.')
  })

  it('never puts a preference, a gender or a habit into words', () => {
    const text = [templatedNote(sam, dana), ...matchChips(sam, dana), ...sharedChips(sam, dana)].join(' ').toLowerCase()
    for (const word of ['cigar', 'smok', 'alcohol', 'drink', 'marijuana', 'music', 'gender', 'female', 'male', 'prefer']) {
      expect(text).not.toContain(word)
    }
  })

  it('shows the member what the two share', () => {
    expect(sharedChips(sam, dana)).toEqual(['Both weekday early', 'Both support St. Jude'])
  })

  it('falls back to a plain sentence when nothing lines up', () => {
    const a = subject('a', {}, { play_times: ['weekend_morning'] })
    const b = subject('b', {}, { play_times: ['weekday_twilight'] })
    expect(templatedNote(a, b)).toBe('We think you and B would enjoy a round together.')
  })
})

describe('validateSurvey', () => {
  const complete = {
    goals: ['new_clients'],
    meet_company_sizes: ['any'],
    company_size: '11_50',
    play_times: ['weekend_morning'],
    attitude: 'relaxed',
    skill: 'good',
    pref_gender: 'any',
    pref_skill: 'good',
    pref_attitude: 'any',
    ...Object.fromEntries(HABITS.flatMap(h => [[`does_${h.key}`, false], [`minds_${h.key}`, false]])),
    value_offered: '  Fractional CFO work  ',
  }

  it('accepts a complete survey and splits it into its two tables', () => {
    const r = validateSurvey(complete)
    expect(r.valid).toBe(true)
    expect(r.match?.pref_skill).toBe('good')
    expect(r.match?.skill).toBe('good')
    expect(r.match?.open_to_suggestions).toBe(true)
    expect(r.profile?.value_offered).toBe('Fractional CFO work')
  })

  it('leaves preferred industries, roles, own industry and role, and gender optional', () => {
    const r = validateSurvey({ ...complete, meet_industries: undefined, meet_roles: [], industry: '', role: null, gender: undefined })
    expect(r.valid).toBe(true)
    expect(r.match?.meet_industries).toEqual([])
    expect(r.match?.industry).toBeNull()
    expect(r.match?.gender).toBeNull()
  })

  it('requires the rest, each yes / no included', () => {
    const r = validateSurvey({ ...complete, pref_gender: undefined, does_alcohol: undefined, play_times: [], skill: undefined, meet_company_sizes: [] })
    expect(r.valid).toBe(false)
    expect(r.errors).toEqual(expect.arrayContaining([
      'Choose when you prefer to play',
      'Choose your golf skill',
      'Choose an ideal company size, or Any size',
      'Answer "Do you have a gender preference"',
      'Answer "Do you drink alcohol on the course?"',
    ]))
  })

  it('refuses unknown options, the old industries, a fourth objective and Prefer not to say', () => {
    expect(validateSurvey({ ...complete, pref_skill: 'pro' }).valid).toBe(false)
    expect(validateSurvey({ ...complete, goals: ['new_clients', 'capital', 'hiring', 'vendors'] }).valid).toBe(false)
    expect(validateSurvey({ ...complete, meet_industries: ['Business Owner / Founder'] }).valid).toBe(false)
    expect(validateSurvey({ ...complete, industry: 'Other' }).valid).toBe(false)
    expect(validateSurvey({ ...complete, gender: 'undisclosed' }).valid).toBe(false)
  })

  it('lets Any size stand alone', () => {
    expect(validateSurvey({ ...complete, meet_company_sizes: ['1_10', 'any'] }).match?.meet_company_sizes).toEqual(['any'])
  })
})

describe('toMatchProfile', () => {
  it('drops values it does not recognise and reads a stored row as on', () => {
    const p = toMatchProfile({
      goals: ['new_clients', 'world_domination'],
      pref_skill: 'pro',
      gender: 'undisclosed',
      meet_industries: ['Other', 'Technology'],
      open_to_suggestions: null,
    })
    expect(p.goals).toEqual(['new_clients'])
    expect(p.pref_skill).toBeNull()
    expect(p.gender).toBeNull()
    expect(p.meet_industries).toEqual(['Technology'])
    expect(p.open_to_suggestions).toBe(true)
  })

  it('reads no row as off', () => {
    expect(toMatchProfile(null).open_to_suggestions).toBe(false)
  })
})

describe('eligibleForIntroductions', () => {
  it('offers it to members of a club, and nobody else', () => {
    expect(eligibleForIntroductions({ home_course_id: 'c1', membership_status: 'active', hasMembership: true })).toBe(true)
    expect(eligibleForIntroductions({ home_course_id: null, membership_status: 'active', hasMembership: true })).toBe(false)
    expect(eligibleForIntroductions({ home_course_id: 'c1', membership_status: 'active', hasMembership: false })).toBe(false)
    expect(eligibleForIntroductions({ home_course_id: 'c1', membership_status: 'suspended', hasMembership: true })).toBe(false)
  })
})
