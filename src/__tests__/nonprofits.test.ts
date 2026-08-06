import { describe, it, expect } from 'vitest'
import {
  parseNonprofits,
  formatNonprofits,
  matchesNonprofit,
  MAX_NONPROFITS,
  MAX_NONPROFIT_LENGTH,
} from '@/lib/profile/nonprofits'

// Three callers share these rules — the profile API, the GHL sync, and admin
// search. If they drift, the same member's list looks different depending on
// how it arrived.

describe('parseNonprofits', () => {
  it('splits on newlines', () => {
    expect(parseNonprofits('Red Cross\nHabitat for Humanity')).toEqual([
      'Red Cross', 'Habitat for Humanity',
    ])
  })

  it('handles CRLF, which is what a Windows paste produces', () => {
    expect(parseNonprofits('Red Cross\r\nHabitat for Humanity')).toEqual([
      'Red Cross', 'Habitat for Humanity',
    ])
  })

  it('trims and drops blank lines', () => {
    expect(parseNonprofits('  Red Cross  \n\n   \nHabitat for Humanity\n')).toEqual([
      'Red Cross', 'Habitat for Humanity',
    ])
  })

  it('dedupes case-insensitively, keeping the first spelling', () => {
    // The member's own capitalisation is what shows on their profile.
    expect(parseNonprofits('Red Cross\nRED CROSS\nred cross')).toEqual(['Red Cross'])
  })

  it('accepts an array as readily as a string', () => {
    // The profile API may receive either — a client that already split it, or
    // raw textarea text.
    expect(parseNonprofits(['Red Cross', '', ' Habitat '])).toEqual(['Red Cross', 'Habitat'])
  })

  it('returns empty for null, undefined and blank input', () => {
    expect(parseNonprofits(null)).toEqual([])
    expect(parseNonprofits(undefined)).toEqual([])
    expect(parseNonprofits('   \n\n  ')).toEqual([])
  })

  it('truncates an absurdly long entry rather than rejecting it', () => {
    const [only] = parseNonprofits('x'.repeat(500))
    expect(only).toHaveLength(MAX_NONPROFIT_LENGTH)
  })

  it('does NOT cap at MAX_NONPROFITS — that is the caller’s policy', () => {
    // The profile API rejects a fourth so the member can fix it; the GHL sync
    // truncates because it can't ask. Both need to see the real count first.
    expect(parseNonprofits('a\nb\nc\nd')).toHaveLength(4)
    expect(MAX_NONPROFITS).toBe(3)
  })
})

describe('formatNonprofits', () => {
  it('round-trips through the textarea', () => {
    const stored = ['Red Cross', 'Habitat for Humanity']
    expect(parseNonprofits(formatNonprofits(stored))).toEqual(stored)
  })

  it('renders an empty or missing list as an empty box', () => {
    expect(formatNonprofits([])).toBe('')
    expect(formatNonprofits(null)).toBe('')
  })
})

describe('matchesNonprofit', () => {
  it('matches a substring, case-insensitively', () => {
    // Admin search is a lookup — "boys" has to find "Boys & Girls Club".
    expect(matchesNonprofit(['Boys & Girls Club'], 'boys')).toBe(true)
    expect(matchesNonprofit(['Boys & Girls Club'], 'GIRLS')).toBe(true)
  })

  it('does not match an empty query against everyone', () => {
    // Guarded because '' is a substring of every string — without this, an
    // empty search box would "match" every member with a non-profit.
    expect(matchesNonprofit(['Red Cross'], '')).toBe(false)
    expect(matchesNonprofit(['Red Cross'], '   ')).toBe(false)
  })

  it('is safe on a member with no non-profits', () => {
    expect(matchesNonprofit([], 'red')).toBe(false)
    expect(matchesNonprofit(null, 'red')).toBe(false)
    expect(matchesNonprofit(undefined, 'red')).toBe(false)
  })

  it('returns false for a genuine non-match', () => {
    expect(matchesNonprofit(['Red Cross'], 'habitat')).toBe(false)
  })
})
