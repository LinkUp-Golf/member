import { describe, it, expect } from 'vitest'
import {
  fitsPreferences,
  matchChips,
  mutualFit,
  pairScore,
  sameIndustry,
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
  PLAY_TIMES,
  PREF_SKILLS,
  SKILLS,
  eligibleForIntroductions,
  normalisePlayTimes,
  optionLabel,
  roleFromTitle,
  toMatchProfile,
  toMatchRow,
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
      play_times: ['weekday_afternoon'],
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

describe('sameIndustry', () => {
  it('matches the same words, or a shared word that is not generic', () => {
    expect(sameIndustry('construction', 'Construction')).toBe(true)
    expect(sameIndustry('Legal tech', 'Professional Services (Legal)')).toBe(true)
    expect(sameIndustry('Marketing services', 'Business Services')).toBe(false)
    expect(sameIndustry('Aviation', 'Technology')).toBe(false)
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

  it('counts an industry named under Other toward the industries a member wants to meet', () => {
    const wantsBuilders = subject('sam', {}, { meet_industry_other: 'Construction' })
    const builder = subject('dana', { industry: 'Construction & Engineering' })
    const lawyer = subject('lee', { industry: 'Professional Services (Legal)' })
    expect(matchChips(wantsBuilders, builder)).toContain('Industry they want to meet')
    expect(matchChips(wantsBuilders, lawyer)).not.toContain('Industry they want to meet')
    expect(pairScore(wantsBuilders, builder, NOW)).toBeGreaterThan(pairScore(wantsBuilders, lawyer, NOW))
    expect(templatedNote(wantsBuilders, builder)).toContain('Dana works in Construction & Engineering, the kind of person you want to meet')
  })

  it('treats blank industries, roles and Any size as anyone, as before', () => {
    const open = subject('sam')
    const a = subject('dana', { industry: 'Insurance', role: 'sales' }, { company_size: '1000_up' })
    const b = subject('lee', { industry: 'Technology', role: 'founder' }, { company_size: 'solo' })
    expect(pairScore(open, a, NOW)).toBe(pairScore(open, b, NOW))
    expect(matchChips(open, a).some(c => /want to meet|size they want/.test(c))).toBe(false)
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
    expect(templatedNote(sam, dana)).toBe('Dana is a founder, the kind of client you serve, and you both play on weekday afternoons.')
  })

  it('names the role a member asked to meet', () => {
    const wantsFounders = subject('sam', {}, { meet_roles: ['founder'], play_times: ['weekend_afternoon'] })
    expect(templatedNote(wantsFounders, dana)).toBe('Dana is a founder, the kind of person you want to meet.')
  })

  it('never puts a preference, a gender or a habit into words', () => {
    const text = [templatedNote(sam, dana), ...matchChips(sam, dana), ...sharedChips(sam, dana)].join(' ').toLowerCase()
    for (const word of ['cigar', 'smok', 'alcohol', 'drink', 'marijuana', 'music', 'gender', 'female', 'male', 'prefer']) {
      expect(text).not.toContain(word)
    }
  })

  it('shows the member what the two share', () => {
    expect(sharedChips(sam, dana)).toEqual(['Both weekday afternoons', 'Both support St. Jude'])
  })

  it('falls back to a plain sentence when nothing lines up', () => {
    const a = subject('a', {}, { play_times: ['weekend_afternoon'] })
    const b = subject('b', {}, { play_times: ['weekday_afternoon'] })
    expect(templatedNote(a, b)).toBe('We think you and B would enjoy a round together.')
  })
})

describe('validateSurvey', () => {
  const complete = {
    goals: ['new_clients'],
    meet_company_sizes: ['any'],
    company_size: '11_50',
    play_times: ['weekend_afternoon'],
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
      'Choose a preferred company size, or Any size',
      'Answer "Do you have a gender preference"',
      'Answer "Do you drink alcohol on the course?"',
    ]))
  })

  it('refuses unknown options, the old industries and Prefer not to say', () => {
    expect(validateSurvey({ ...complete, pref_skill: 'pro' }).valid).toBe(false)
    expect(validateSurvey({ ...complete, meet_industries: ['Business Owner / Founder'] }).valid).toBe(false)
    expect(validateSurvey({ ...complete, industry: 'Other' }).valid).toBe(false)
    expect(validateSurvey({ ...complete, gender: 'undisclosed' }).valid).toBe(false)
  })

  it('lets Any size stand alone', () => {
    expect(validateSurvey({ ...complete, meet_company_sizes: ['1_10', 'any'] }).match?.meet_company_sizes).toEqual(['any'])
  })

  it('takes as many objectives as the member likes, every one included', () => {
    const all = MATCH_GOALS.map(g => g.value)
    const r = validateSurvey({ ...complete, goals: all })
    expect(r.valid).toBe(true)
    expect(r.match?.goals).toEqual(all)
  })

  it('takes several preferred roles and company sizes', () => {
    const r = validateSurvey({ ...complete, meet_roles: ['founder', 'finance', 'marketing'], meet_company_sizes: ['1_10', '11_50', '1000_up'] })
    expect(r.match?.meet_roles).toEqual(['founder', 'finance', 'marketing'])
    expect(r.match?.meet_company_sizes).toEqual(['1_10', '11_50', '1000_up'])
  })

  it('keeps an industry named under Other, and stores it beside the listed ones', () => {
    const r = validateSurvey({ ...complete, meet_industries: ['Technology'], meet_industry_other: '  Construction   & Engineering ', industry_other: 'Hospitality' })
    expect(r.valid).toBe(true)
    expect(r.match?.meet_industries).toEqual(['Technology'])
    expect(r.match?.meet_industry_other).toBe('Construction & Engineering')
    expect(r.match?.industry).toBeNull()
    expect(r.match?.industry_other).toBe('Hospitality')
    if (!r.match) throw new Error('expected answers')
    const row = toMatchRow(r.match)
    expect(row.meet_industries).toEqual(['Technology', 'Construction & Engineering'])
    expect(row.industry).toBe('Hospitality')
    expect(row).not.toHaveProperty('meet_industry_other')
    expect(row).not.toHaveProperty('industry_other')
  })

  it('reads an Other industry that is on the list as the listed one', () => {
    const r = validateSurvey({ ...complete, meet_industries: [], meet_industry_other: 'real estate', industry_other: 'technology' })
    expect(r.match?.meet_industries).toEqual(['Real Estate'])
    expect(r.match?.meet_industry_other).toBeNull()
    expect(r.match?.industry).toBe('Technology')
    expect(r.match?.industry_other).toBeNull()
  })

  it('refuses an Other industry that is too long, and drops a bare "Other"', () => {
    expect(validateSurvey({ ...complete, meet_industry_other: 'x'.repeat(61) }).valid).toBe(false)
    expect(validateSurvey({ ...complete, meet_industry_other: 'Other' }).match?.meet_industry_other).toBeNull()
  })

  it('accepts the play times the survey used to offer, as afternoons', () => {
    const r = validateSurvey({ ...complete, play_times: ['weekday_early', 'weekday_twilight', 'weekend_morning'] })
    expect(r.valid).toBe(true)
    expect(r.match?.play_times).toEqual(['weekday_afternoon', 'weekend_afternoon'])
  })
})

describe('wording', () => {
  it('offers afternoons only', () => {
    expect(PLAY_TIMES.map(t => t.label)).toEqual(['Weekday afternoons', 'Weekend afternoons'])
  })

  it('words golf skill as the client asked, with no handicap talk', () => {
    expect(SKILLS.map(s => s.label)).toEqual(["I'm an excellent golfer", "I'm a good golfer", "I'm a new golfer"])
    for (const o of [...SKILLS, ...PREF_SKILLS]) {
      expect(o.label.toLowerCase()).not.toContain('handicap')
      expect(o.label).not.toContain(' - ')
    }
  })
})

describe('normalisePlayTimes', () => {
  it('moves each retired time onto the afternoon of the same kind of day, once', () => {
    expect(normalisePlayTimes(['weekday_early', 'weekday_midday', 'weekday_twilight'])).toEqual(['weekday_afternoon'])
    expect(normalisePlayTimes(['weekend_morning', 'weekend_afternoon'])).toEqual(['weekend_afternoon'])
    expect(normalisePlayTimes(null)).toBeNull()
  })
})

describe('roleFromTitle', () => {
  it('reads a role from a job title that says it plainly', () => {
    expect(roleFromTitle('Founder & CEO')).toBe('founder')
    expect(roleFromTitle('Owner')).toBe('founder')
    expect(roleFromTitle('CFO')).toBe('finance')
    expect(roleFromTitle('VP of Marketing')).toBe('marketing')
    expect(roleFromTitle('Head of Sales')).toBe('sales')
    expect(roleFromTitle('General Counsel')).toBe('legal')
  })

  it('guesses nothing when the title is unclear', () => {
    expect(roleFromTitle('Vice President')).toBeNull()
    expect(roleFromTitle('Product Owner')).toBeNull()
    expect(roleFromTitle('Business Development Manager')).toBeNull()
    expect(roleFromTitle('')).toBeNull()
    expect(roleFromTitle(null)).toBeNull()
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

  it('reads a stored industry that is not on the list as one the member named', () => {
    const p = toMatchProfile({ meet_industries: ['Technology', 'Construction', 'Business Owner / Founder'], industry: 'Hospitality' })
    expect(p.meet_industries).toEqual(['Technology'])
    expect(p.meet_industry_other).toBe('Construction')
    expect(p.industry).toBeNull()
    expect(p.industry_other).toBe('Hospitality')
    expect(toMatchProfile({ industry: 'Other' }).industry_other).toBeNull()
    expect(toMatchProfile({ industry: 'Technology' }).industry_other).toBeNull()
  })

  it('reads the old play times as afternoons, so earlier answers still match', () => {
    expect(toMatchProfile({ play_times: ['weekday_early', 'weekend_morning'] }).play_times).toEqual(['weekday_afternoon', 'weekend_afternoon'])
  })

  it('reads back what toMatchRow wrote', () => {
    const answers = { ...EMPTY_MATCH_PROFILE, meet_industries: ['Insurance' as const], meet_industry_other: 'Aviation', industry_other: 'Hospitality', completed_at: null }
    const back = toMatchProfile(toMatchRow(answers) as Record<string, unknown>)
    expect(back.meet_industries).toEqual(['Insurance'])
    expect(back.meet_industry_other).toBe('Aviation')
    expect(back.industry_other).toBe('Hospitality')
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
