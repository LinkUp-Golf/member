import { describe, it, expect } from 'vitest'
import { summariseDates } from '@/lib/utils'

// The host date picker lists back what's been chosen. Thirty dates written out
// one by one hides the thing the reader is looking for — whether they're in a
// row — so these lock the shape of the summary rather than its prettiness.

const YEAR = new Date().getFullYear()
const NEXT = YEAR + 1
const d = (month: string, day: string, year: number = YEAR) => `${year}-${month}-${day}`

describe('summariseDates', () => {
  it('returns empty for no dates', () => {
    expect(summariseDates([])).toBe('')
  })

  it('ignores blanks and anything that is not a date', () => {
    expect(summariseDates(['', '  ', 'tomorrow', '2026-8-4'])).toBe('')
  })

  it('gives a single date its weekday', () => {
    // 4 Aug 2026 is a Tuesday. Written as a fixed year, so the year suffix
    // depends on whether the suite is being run in 2026.
    const expected = YEAR === 2026 ? 'Tue, Aug 4' : 'Tue, Aug 4 2026'
    expect(summariseDates(['2026-08-04'])).toBe(expected)
  })

  it('drops the year on a single date in this year', () => {
    const out = summariseDates([d('08', '04')])
    expect(out).toContain('Aug 4')
    expect(out).not.toContain(String(YEAR))
  })

  it('collapses two consecutive days into a range', () => {
    expect(summariseDates([d('08', '04'), d('08', '05')])).toBe('Aug 4–5')
  })

  it('collapses a longer run', () => {
    expect(
      summariseDates([d('08', '04'), d('08', '05'), d('08', '06'), d('08', '07')]),
    ).toBe('Aug 4–7')
  })

  it('lists non-consecutive days in the same month together', () => {
    expect(summariseDates([d('08', '04'), d('08', '18')])).toBe('Aug 4, 18')
  })

  it('mixes runs and singles within a month', () => {
    expect(
      summariseDates([d('08', '04'), d('08', '05'), d('08', '18')]),
    ).toBe('Aug 4–5, 18')
  })

  it('names each month once, separated', () => {
    expect(
      summariseDates([d('08', '04'), d('08', '05'), d('09', '01')]),
    ).toBe('Aug 4–5 · Sep 1')
  })

  it('sorts input it was given out of order', () => {
    expect(summariseDates([d('09', '01'), d('08', '04')])).toBe('Aug 4 · Sep 1')
  })

  it('deduplicates', () => {
    // Down to one date, so it takes the single-date form.
    expect(summariseDates([d('08', '04'), d('08', '04')])).toBe(
      summariseDates([d('08', '04')]),
    )
  })

  it('treats a month boundary as consecutive, and names where it lands', () => {
    // 31 Aug and 1 Sep are a run; "31–1" would read as a typo.
    expect(summariseDates([d('08', '31'), d('09', '01')])).toBe('Aug 31 – Sep 1')
  })

  it('treats a year boundary as consecutive', () => {
    expect(summariseDates([`${YEAR}-12-31`, `${NEXT}-01-01`])).toBe('Dec 31 – Jan 1')
  })

  it('carries the year on a month that is not in this one', () => {
    const out = summariseDates([d('08', '04'), d('03', '07', NEXT)])
    expect(out).toBe(`Aug 4 · Mar 7 ${NEXT}`)
  })

  it('keeps two separate months in the same year apart', () => {
    expect(
      summariseDates([d('08', '04'), d('08', '06'), d('10', '02')]),
    ).toBe('Aug 4, 6 · Oct 2')
  })
})
