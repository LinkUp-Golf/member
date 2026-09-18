import { describe, it, expect } from 'vitest'
import {
  normaliseEventDates,
  validateHostedEventPayload,
  MAX_EVENT_DATES,
} from '@/lib/validation'
import { resolveTeeTimes } from '@/lib/hosts/events'

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

describe('validateHostedEventPayload with a tee time per date', () => {
  const base = {
    course_id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    event_dates: ['2099-06-01', '2099-06-08'],
  }

  it('accepts a tee time for each date, blanks included', () => {
    const r = validateHostedEventPayload({
      ...base,
      tee_times: { '2099-06-01': '8:30 AM', '2099-06-08': '' },
    })
    expect(r.valid).toBe(true)
  })

  it('rejects tee times that are not keyed by date', () => {
    expect(validateHostedEventPayload({ ...base, tee_times: ['8:30 AM'] }).valid).toBe(false)
    expect(validateHostedEventPayload({ ...base, tee_times: { monday: '8:30 AM' } }).valid).toBe(false)
  })

  it('holds each tee time to the same length bound as the single field', () => {
    const r = validateHostedEventPayload({
      ...base,
      tee_times: { '2099-06-01': 'x'.repeat(51) },
    })
    expect(r.valid).toBe(false)
  })
})

describe('resolveTeeTimes', () => {
  const dates = ['2099-06-01', '2099-06-08', '2099-06-15']

  it('gives each date the tee time it was given', () => {
    // The whole point of asking per date: each becomes its own hosted_events
    // row, and each row stores its own time.
    const times = resolveTeeTimes(dates, {
      tee_times: { '2099-06-01': ' 8:30 AM ', '2099-06-08': 'afternoon' },
    })
    expect(times.get('2099-06-01')).toBe('8:30 AM')
    expect(times.get('2099-06-08')).toBe('afternoon')
    // Not named, and nothing shared to fall back on: no fixed time.
    expect(times.get('2099-06-15')).toBeNull()
  })

  it('reads a blank tee time as no fixed time', () => {
    const times = resolveTeeTimes(dates, { tee_times: { '2099-06-01': '   ' } })
    expect(times.get('2099-06-01')).toBeNull()
  })

  it('falls back to a one-for-all tee time for dates the map skips', () => {
    // What an older client sends, and what the edit form still sends for its
    // single date.
    const times = resolveTeeTimes(dates, {
      tee_time: 'morning',
      tee_times: { '2099-06-08': '1:00 PM' },
    })
    expect([...times.values()]).toEqual(['morning', '1:00 PM', 'morning'])
  })

  it('sanitises what the host typed, like every other free-text field', () => {
    const times = resolveTeeTimes(['2099-06-01'], {
      tee_times: { '2099-06-01': '<script>8:30</script>' },
    })
    expect(times.get('2099-06-01')).not.toContain('<script>')
  })

  it('ignores a tee_times that is not a map', () => {
    expect([...resolveTeeTimes(dates, { tee_times: ['8:30 AM'] }).values()]).toEqual([
      null, null, null,
    ])
  })
})
