import { describe, it, expect } from 'vitest'
import {
  normaliseEventDates,
  validateHostedEventPayload,
  MAX_EVENT_DATES,
} from '@/lib/validation'

// A hosted-event submission carries one date or several. `event_dates` is the
// multi-date form (one event per date, everything else shared); `event_date` is
// the single-date shorthand that predates it. Both must go through the same rules
// so a one-date submission can't behave differently from the first of many.

describe('normaliseEventDates', () => {
  it('reads a single event_date as a one-element list', () => {
    expect(normaliseEventDates({ event_date: '2099-06-01' })).toEqual(['2099-06-01'])
  })

  it('reads event_dates as-is', () => {
    expect(normaliseEventDates({ event_dates: ['2099-06-01', '2099-06-08'] }))
      .toEqual(['2099-06-01', '2099-06-08'])
  })

  it('prefers event_dates when both are present', () => {
    const result = normaliseEventDates({
      event_date: '2099-01-01',
      event_dates: ['2099-06-01'],
    })
    expect(result).toEqual(['2099-06-01'])
  })

  it('drops blank entries and trims', () => {
    expect(normaliseEventDates({ event_dates: ['  2099-06-01  ', '', '   '] }))
      .toEqual(['2099-06-01'])
  })

  it('returns null when nothing usable is given', () => {
    expect(normaliseEventDates({})).toBeNull()
    expect(normaliseEventDates({ event_date: '   ' })).toBeNull()
    expect(normaliseEventDates({ event_dates: [] })).toBeNull()
    expect(normaliseEventDates({ event_dates: ['', ''] })).toBeNull()
    expect(normaliseEventDates(null)).toBeNull()
  })

  it('ignores non-string entries rather than passing them through', () => {
    expect(normaliseEventDates({ event_dates: ['2099-06-01', 42, null] }))
      .toEqual(['2099-06-01'])
  })
})

describe('validateHostedEventPayload with multiple dates', () => {
  const base = {
    course_id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    total_spots: 4,
    member_guest_rate: 150,
  }

  it('accepts several valid dates', () => {
    const r = validateHostedEventPayload({ ...base, event_dates: ['2099-06-01', '2099-06-08'] })
    expect(r.valid).toBe(true)
  })

  it('still accepts the single-date shorthand', () => {
    expect(validateHostedEventPayload({ ...base, event_date: '2099-06-01' }).valid).toBe(true)
  })

  it('rejects a payload with no dates at all', () => {
    const r = validateHostedEventPayload(base)
    expect(r.valid).toBe(false)
    expect(r.errors.some(e => /date/i.test(e))).toBe(true)
  })

  it('rejects duplicate dates', () => {
    // Two events on the same day at the same venue is a mistake, not a schedule.
    const r = validateHostedEventPayload({ ...base, event_dates: ['2099-06-01', '2099-06-01'] })
    expect(r.valid).toBe(false)
    expect(r.errors.some(e => /once/i.test(e))).toBe(true)
  })

  it('rejects a malformed date anywhere in the list', () => {
    expect(validateHostedEventPayload({ ...base, event_dates: ['2099-06-01', '06/08/2099'] }).valid)
      .toBe(false)
  })

  it(`rejects more than ${MAX_EVENT_DATES} dates`, () => {
    // Genuinely distinct dates, walking forward a day at a time, so this fails on
    // the cap and not on the duplicate check.
    const many = Array.from({ length: MAX_EVENT_DATES + 1 }, (_, i) => {
      const d = new Date(Date.UTC(2099, 5, 1))
      d.setUTCDate(d.getUTCDate() + i)
      return d.toISOString().slice(0, 10)
    })
    expect(new Set(many).size).toBe(many.length)

    const r = validateHostedEventPayload({ ...base, event_dates: many })
    expect(r.valid).toBe(false)
    expect(r.errors.some(e => new RegExp(`${MAX_EVENT_DATES}`).test(e))).toBe(true)
  })

  it(`accepts exactly ${MAX_EVENT_DATES} dates`, () => {
    const atCap = Array.from({ length: MAX_EVENT_DATES }, (_, i) => {
      const d = new Date(Date.UTC(2099, 5, 1))
      d.setUTCDate(d.getUTCDate() + i)
      return d.toISOString().slice(0, 10)
    })
    expect(validateHostedEventPayload({ ...base, event_dates: atCap }).valid).toBe(true)
  })

  it('leaves dates alone on a partial (PATCH) payload that omits them', () => {
    const r = validateHostedEventPayload({ total_spots: 6 }, { partial: true })
    expect(r.valid).toBe(true)
  })
})
