import { describe, it, expect } from 'vitest'
import {
  fitsPreferences,
  handicapLevel,
  matchChips,
  mutualFit,
  pairScore,
  sharedChips,
  templatedNote,
  type MatchSubject,
} from '@/lib/matching/rules'
import {
  EMPTY_MATCH_PROFILE,
  HABITS,
  requiresMatchSurvey,
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
      company_size: '2_10',
      play_times: ['weekday_early'],
      attitude: 'friendly',
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
      completed_at: '2026-11-01T00:00:00Z',
      ...match,
    },
  }
}

describe('handicapLevel', () => {
  it('splits at 10 and 19, and reads no handicap as a new golfer', () => {
    expect(handicapLevel(2.4)).toBe('low')
    expect(handicapLevel(9.9)).toBe('low')
    expect(handicapLevel(10)).toBe('mid')
    expect(handicapLevel(18.9)).toBe('mid')
    expect(handicapLevel(19)).toBe('high')
    expect(handicapLevel(null)).toBe('high')
  })
})

describe('fitsPreferences', () => {
  const sam = subject('sam')

  it('lets everyone through when there are no preferences', () => {
    expect(fitsPreferences(sam, subject('dana'))).toBe(true)
  })

  it('applies a gender preference, and Prefer not to say only fits no preference', () => {
    const wantsMale = subject('sam', {}, { pref_gender: 'male' })
    expect(fitsPreferences(wantsMale, subject('dana', {}, { gender: 'female' }))).toBe(false)
    expect(fitsPreferences(wantsMale, subject('marcus', {}, { gender: 'male' }))).toBe(true)
    expect(fitsPreferences(wantsMale, subject('ali', {}, { gender: 'undisclosed' }))).toBe(false)
    expect(fitsPreferences(sam, subject('ali', {}, { gender: 'undisclosed' }))).toBe(true)
  })

  it('maps each skill level onto handicap bands', () => {
    const excellent = subject('sam', {}, { pref_skill: 'excellent' })
    const good = subject('sam', {}, { pref_skill: 'good' })
    const newer = subject('sam', {}, { pref_skill: 'new' })
    const low = subject('a', { handicap: 6 })
    const mid = subject('b', { handicap: 15 })
    const none = subject('c', { handicap: null })
    expect([low, mid, none].map(c => fitsPreferences(excellent, c))).toEqual([true, false, false])
    expect([low, mid, none].map(c => fitsPreferences(good, c))).toEqual([true, true, false])
    expect([low, mid, none].map(c => fitsPreferences(newer, c))).toEqual([false, false, true])
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
    client_industries: ['Business Owner / Founder'],
  })

  it('ranks a strong two-way fit above a weak one', () => {
    const dana = subject('dana', { industry: 'Financial Services', valueOffered: 'wealth management for founders' }, {
      goals: ['referral_partners'],
      meet_industries: ['Professional Services (Accounting)'],
    })
    const quiet = subject('quiet', { industry: 'Other', lastSignIn: null }, { play_times: ['weekend_afternoon'], attitude: 'serious' })
    expect(pairScore(sam, dana, NOW)).toBeGreaterThan(pairScore(sam, quiet, NOW))
  })

  it('is symmetric and stays within 0 to 100', () => {
    const dana = subject('dana', { industry: 'Business Owner / Founder' }, { goals: ['new_clients'] })
    const ab = pairScore(sam, dana, NOW)
    expect(ab).toBe(pairScore(dana, sam, NOW))
    expect(ab).toBeGreaterThanOrEqual(0)
    expect(ab).toBeLessThanOrEqual(100)
  })
})

describe('chips and notes', () => {
  const sam = subject('sam', { nonprofits: ['St. Jude'] }, {
    goals: ['new_clients'],
    client_industries: ['Business Owner / Founder'],
    minds_cigars: true,
    pref_gender: 'female',
  })
  const dana = subject('dana', { industry: 'Business Owner / Founder', nonprofits: ['st. jude'] }, { gender: 'female' })

  it('writes the note from the networking answers', () => {
    expect(templatedNote(sam, dana)).toBe('Dana is a founder, the kind of client you serve, and you both play early on weekdays.')
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
    meet_industries: ['Technology'],
    company_size: '11_50',
    play_times: ['weekend_morning'],
    attitude: 'relaxed',
    gender: 'male',
    pref_gender: 'any',
    pref_skill: 'good',
    pref_attitude: 'any',
    ...Object.fromEntries(HABITS.flatMap(h => [[`does_${h.key}`, false], [`minds_${h.key}`, false]])),
    handicap_index: '12.4',
    nonprofits: 'St. Jude\nHabitat for Humanity',
  }

  it('accepts a complete survey and splits it into its two tables', () => {
    const r = validateSurvey(complete)
    expect(r.valid).toBe(true)
    expect(r.match?.pref_skill).toBe('good')
    expect(r.match?.open_to_suggestions).toBe(true)
    expect(r.profile?.handicap_index).toBe(12.4)
    expect(r.profile?.nonprofits).toEqual(['St. Jude', 'Habitat for Humanity'])
  })

  it('requires every pick-list and each yes / no', () => {
    const r = validateSurvey({ ...complete, pref_gender: undefined, does_alcohol: undefined, play_times: [] })
    expect(r.valid).toBe(false)
    expect(r.errors).toEqual(expect.arrayContaining([
      'Choose when you usually play',
      'Answer "Do you have a gender preference"',
      'Answer "Do you drink alcohol on the course?"',
    ]))
  })

  it('refuses unknown options, a fourth goal and a handicap out of range', () => {
    expect(validateSurvey({ ...complete, pref_skill: 'pro' }).valid).toBe(false)
    expect(validateSurvey({ ...complete, goals: ['new_clients', 'capital', 'hiring', 'vendors'] }).valid).toBe(false)
    expect(validateSurvey({ ...complete, handicap_index: 60 }).valid).toBe(false)
  })

  it('lets the free text, the handicap and best clients stay empty', () => {
    const r = validateSurvey({ ...complete, handicap_index: '', nonprofits: '', client_industries: undefined })
    expect(r.valid).toBe(true)
    expect(r.profile?.handicap_index).toBeNull()
  })
})

describe('toMatchProfile', () => {
  it('drops values it does not recognise and defaults the toggle on', () => {
    const p = toMatchProfile({ goals: ['new_clients', 'world_domination'], pref_skill: 'pro', open_to_suggestions: null })
    expect(p.goals).toEqual(['new_clients'])
    expect(p.pref_skill).toBeNull()
    expect(p.open_to_suggestions).toBe(true)
  })
})

describe('requiresMatchSurvey', () => {
  it('asks members of a club, and nobody else', () => {
    expect(requiresMatchSurvey({ home_course_id: 'c1', membership_status: 'active', hasMembership: true })).toBe(true)
    expect(requiresMatchSurvey({ home_course_id: null, membership_status: 'active', hasMembership: true })).toBe(false)
    expect(requiresMatchSurvey({ home_course_id: 'c1', membership_status: 'active', hasMembership: false })).toBe(false)
    expect(requiresMatchSurvey({ home_course_id: 'c1', membership_status: 'suspended', hasMembership: true })).toBe(false)
  })
})
