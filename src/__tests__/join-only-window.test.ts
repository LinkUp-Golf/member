import { describe, it, expect } from 'vitest'
import {
  dayIsBookable,
  daysUntil,
  isInsideJoinOnlyWindow,
  joinOnlyWindowMessage,
  JOIN_ONLY_WINDOW_DAYS,
} from '@/lib/bookings/lead-time'

// The last few days before a round: a member can join one that's going out and
// can't start one from nothing. The rule is about the day, not the member, and
// three places read it — the month grid, the single-date filter and
// POST /api/bookings/create — so a day offered by one and refused by another
// would be the failure that matters.

const TODAY = '2026-06-10'

describe('daysUntil', () => {
  it('counts whole calendar days', () => {
    expect(daysUntil('2026-06-10', TODAY)).toBe(0)
    expect(daysUntil('2026-06-11', TODAY)).toBe(1)
    expect(daysUntil('2026-06-17', TODAY)).toBe(7)
  })

  it('is negative for a day already gone', () => {
    expect(daysUntil('2026-06-09', TODAY)).toBe(-1)
  })

  it('counts across a month and a year boundary', () => {
    expect(daysUntil('2026-07-01', '2026-06-30')).toBe(1)
    expect(daysUntil('2027-01-01', '2026-12-31')).toBe(1)
  })

  it('counts across a daylight-saving change as one day', () => {
    // Parsed as UTC midnights on purpose: a spring-forward day is 23 hours long
    // locally, and dividing elapsed time by 24 would round it to zero.
    expect(daysUntil('2026-03-09', '2026-03-08')).toBe(1)
    expect(daysUntil('2026-11-02', '2026-11-01')).toBe(1)
  })

  it('is NaN for something that is not a date', () => {
    expect(daysUntil('next tuesday', TODAY)).toBeNaN()
  })
})

describe('isInsideJoinOnlyWindow', () => {
  it('covers today and the two days after it', () => {
    expect(JOIN_ONLY_WINDOW_DAYS).toBe(3)
    expect(isInsideJoinOnlyWindow('2026-06-10', TODAY)).toBe(true)
    expect(isInsideJoinOnlyWindow('2026-06-11', TODAY)).toBe(true)
    expect(isInsideJoinOnlyWindow('2026-06-12', TODAY)).toBe(true)
  })

  it('stops at the fourth day, which behaves as it always did', () => {
    expect(isInsideJoinOnlyWindow('2026-06-13', TODAY)).toBe(false)
    expect(isInsideJoinOnlyWindow('2026-07-04', TODAY)).toBe(false)
  })

  it('does not apply to a day already past', () => {
    // A past day is closed for its own reason; calling it "inside the window"
    // would mean a booking on it could reopen it.
    expect(isInsideJoinOnlyWindow('2026-06-09', TODAY)).toBe(false)
  })

  it('is switched off by a window of zero', () => {
    expect(isInsideJoinOnlyWindow('2026-06-10', TODAY, 0)).toBe(false)
    expect(isInsideJoinOnlyWindow('2026-06-10', TODAY, -1)).toBe(false)
  })

  it('treats a date it cannot read as inside it', () => {
    // The safe answer to "may someone book a date I can't parse" is no.
    expect(isInsideJoinOnlyWindow('', TODAY)).toBe(true)
  })
})

describe('dayIsBookable', () => {
  it('lets a member join a day that already has someone on it', () => {
    expect(dayIsBookable({ date: '2026-06-11', today: TODAY, bookedSpots: 1 })).toBe(true)
  })

  it('closes a day inside the window that nobody has booked', () => {
    expect(dayIsBookable({ date: '2026-06-11', today: TODAY, bookedSpots: 0 })).toBe(false)
    expect(dayIsBookable({ date: TODAY, today: TODAY, bookedSpots: 0 })).toBe(false)
  })

  it('leaves everything past the window alone', () => {
    // Which is most of the calendar, and the whole point of the window being
    // short: outside it nothing about booking has changed.
    expect(dayIsBookable({ date: '2026-06-13', today: TODAY, bookedSpots: 0 })).toBe(true)
    expect(dayIsBookable({ date: '2026-09-01', today: TODAY, bookedSpots: 0 })).toBe(true)
  })

  it('one booking is enough — it is the round existing that matters', () => {
    expect(dayIsBookable({ date: '2026-06-10', today: TODAY, bookedSpots: 1 })).toBe(true)
    expect(dayIsBookable({ date: '2026-06-10', today: TODAY, bookedSpots: 4 })).toBe(true)
  })

  it('is off entirely for a caller that passes no window', () => {
    // openSpotsByDate does, so a host is never refused a date for want of the
    // interest they are creating.
    expect(
      dayIsBookable({ date: '2026-06-11', today: TODAY, bookedSpots: 0, windowDays: 0 }),
    ).toBe(true)
  })
})

describe('joinOnlyWindowMessage', () => {
  it('says how many days, so the copy and the rule cannot drift apart', () => {
    expect(joinOnlyWindowMessage()).toContain('within 3 days')
    expect(joinOnlyWindowMessage(5)).toContain('within 5 days')
  })
})
