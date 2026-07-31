import { describe, it, expect } from 'vitest'
import { eventTeeTimeSortKey, formatEventTeeTime } from '@/lib/utils'

// A hosted event's tee time is free text (a host types "8:30 AM", "Shotgun
// 9am", or leaves it blank), so ordering a day's events needs a parsed key.
// Comparing the raw strings put "10:00 AM" ahead of "8:30 AM".

const sorted = (times: (string | null)[]) =>
  [...times].sort((a, b) => eventTeeTimeSortKey(a) - eventTeeTimeSortKey(b))

describe('eventTeeTimeSortKey', () => {
  it('reads a 24h clock value', () => {
    expect(eventTeeTimeSortKey('07:30')).toBe(450)
    expect(eventTeeTimeSortKey('07:30:00')).toBe(450)
    expect(eventTeeTimeSortKey('13:15')).toBe(795)
    expect(eventTeeTimeSortKey('00:00')).toBe(0)
  })

  it('applies am/pm', () => {
    expect(eventTeeTimeSortKey('8:30 AM')).toBe(510)
    expect(eventTeeTimeSortKey('8:30pm')).toBe(1230)
    expect(eventTeeTimeSortKey('12:15 AM')).toBe(15)
    expect(eventTeeTimeSortKey('12:15 PM')).toBe(735)
  })

  it('reads a bare hour that carries am/pm', () => {
    expect(eventTeeTimeSortKey('Shotgun 9am')).toBe(540)
    expect(eventTeeTimeSortKey('tee off 1 PM')).toBe(780)
  })

  it('sorts unreadable and blank times last', () => {
    const last = Number.MAX_SAFE_INTEGER
    expect(eventTeeTimeSortKey(null)).toBe(last)
    expect(eventTeeTimeSortKey('')).toBe(last)
    expect(eventTeeTimeSortKey('   ')).toBe(last)
    expect(eventTeeTimeSortKey('morning')).toBe(last)
    // A stray number without am/pm is not a time.
    expect(eventTeeTimeSortKey('2 groups')).toBe(last)
    // Out of range.
    expect(eventTeeTimeSortKey('25:00')).toBe(last)
    expect(eventTeeTimeSortKey('14:00 PM')).toBe(last)
  })

  it('orders a day chronologically', () => {
    expect(sorted(['10:00 AM', '8:30 AM', null, '1:00 PM', 'Shotgun 9am']))
      .toEqual(['8:30 AM', 'Shotgun 9am', '10:00 AM', '1:00 PM', null])
  })
})

describe('formatEventTeeTime', () => {
  it('formats a clock value to a 12h label', () => {
    expect(formatEventTeeTime('07:30:00')).toBe('7:30 AM')
    expect(formatEventTeeTime('13:15')).toBe('1:15 PM')
    expect(formatEventTeeTime('00:05')).toBe('12:05 AM')
  })

  it('passes free text through and treats blank as no time', () => {
    expect(formatEventTeeTime('Shotgun 9am')).toBe('Shotgun 9am')
    expect(formatEventTeeTime(null)).toBeNull()
    expect(formatEventTeeTime('  ')).toBeNull()
  })
})
