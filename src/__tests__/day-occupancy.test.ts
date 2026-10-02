import { describe, it, expect } from 'vitest'
import {
  dayOccupancy,
  daySplit,
  occupancyLabel,
  occupancyLevel,
  occupancyPercent,
  occupancyTally,
  openingIsFull,
} from '@/lib/bookings/occupancy'

// The month grid's day cell used to say "1P" / "2Ps" — how many members were
// booked, and nothing about whether there was room. It now says "3/12". Both
// numbers are summed across the venues the day lists, and the arithmetic is the
// only part a reader can't check for themselves.

const seats = (bookedSpots: number, totalSpots: number) => ({ bookedSpots, totalSpots })

describe('dayOccupancy', () => {
  it('adds up every venue the day lists', () => {
    expect(dayOccupancy([seats(2, 8), seats(1, 4)])).toEqual({ taken: 3, total: 12 })
  })

  it('is zero of zero on a day with nothing on it', () => {
    expect(dayOccupancy([])).toEqual({ taken: 0, total: 0 })
  })

  it('reports an open day nobody has booked yet', () => {
    expect(dayOccupancy([seats(0, 12)])).toEqual({ taken: 0, total: 12 })
  })

  it('ignores a negative, which is not a number of seats', () => {
    expect(dayOccupancy([seats(-3, 8)])).toEqual({ taken: 0, total: 8 })
    expect(dayOccupancy([seats(2, -8)])).toEqual({ taken: 2, total: 0 })
  })
})

describe('occupancyTally', () => {
  it('prints seats taken over seats the day holds', () => {
    expect(occupancyTally({ taken: 3, total: 12 })).toBe('3/12')
    expect(occupancyTally({ taken: 0, total: 4 })).toBe('0/4')
    expect(occupancyTally({ taken: 4, total: 4 })).toBe('4/4')
  })

  it('says nothing when the day can seat nobody', () => {
    // A cell with no venues on it shows dots for none and should show no tally
    // either — "0/0" reads as a fault in the calendar.
    expect(occupancyTally({ taken: 0, total: 0 })).toBe('')
    expect(occupancyTally({ taken: 2, total: 0 })).toBe('')
  })

  it('never prints more taken than the day holds', () => {
    // Can't happen from venueAvailabilityForMonth, where total is booked + open.
    // If it ever did, the cell would be blamed for it.
    expect(occupancyTally({ taken: 9, total: 4 })).toBe('4/4')
  })
})

describe('occupancyLabel', () => {
  it('says the same thing in words, for the day button', () => {
    expect(occupancyLabel({ taken: 3, total: 12 })).toBe('3 of 12 spots taken')
    expect(occupancyLabel({ taken: 1, total: 1 })).toBe('1 of 1 spot taken')
  })

  it('is empty exactly when the tally is', () => {
    expect(occupancyLabel({ taken: 0, total: 0 })).toBe('')
  })
})

// A venue-day with nothing left to sell is now listed rather than dropped: a
// round is happening on it, and a member choosing a day is better served by
// "happening, full" than by a blank cell. Everything that offers a booking has
// to ask first, so the question gets one definition.

describe('openingIsFull', () => {
  it('is false while there is a seat to sell', () => {
    expect(openingIsFull({ openSpots: 1 })).toBe(false)
    expect(openingIsFull({ openSpots: 12 })).toBe(false)
  })

  it('is true at zero — the day is on, and closed', () => {
    expect(openingIsFull({ openSpots: 0 })).toBe(true)
  })

  it('is true for a count that is not a count', () => {
    // Full is the safe answer: the alternative is offering a booking the
    // database refuses with DAY_FULL after the member has filled the form.
    expect(openingIsFull({ openSpots: -2 })).toBe(true)
    expect(openingIsFull({ openSpots: NaN })).toBe(true)
    expect(openingIsFull({ openSpots: undefined as unknown as number })).toBe(true)
  })
})

describe('daySplit', () => {
  it('separates what can be booked from what is merely happening', () => {
    expect(daySplit([{ openSpots: 4 }, { openSpots: 0 }, { openSpots: 2 }])).toEqual({
      bookable: 2,
      full: 1,
    })
  })

  it('is all-full for a day whose every round is closed', () => {
    // The day still appears on the calendar and the agenda; it just can't be
    // booked, and the header says so rather than counting it as open.
    expect(daySplit([{ openSpots: 0 }, { openSpots: 0 }])).toEqual({ bookable: 0, full: 2 })
  })

  it('is empty for a day with nothing on it', () => {
    expect(daySplit([])).toEqual({ bookable: 0, full: 0 })
  })
})

// Below md the cell draws a bar instead of the fraction — a 46px cell carrying a
// date and a venue dot has nowhere legible to put "12/12". These are the two
// numbers that bar is drawn from.

describe('occupancyPercent', () => {
  it('is the proportion taken, rounded', () => {
    expect(occupancyPercent({ taken: 3, total: 12 })).toBe(25)
    expect(occupancyPercent({ taken: 1, total: 3 })).toBe(33)
    expect(occupancyPercent({ taken: 4, total: 4 })).toBe(100)
  })

  it('is nothing on a day that can seat nobody', () => {
    // Division by zero would render a bar of width NaN%, which is a full bar in
    // some browsers and none in others.
    expect(occupancyPercent({ taken: 0, total: 0 })).toBe(0)
    expect(occupancyPercent({ taken: 3, total: 0 })).toBe(0)
  })

  it('stays inside the track', () => {
    expect(occupancyPercent({ taken: 9, total: 4 })).toBe(100)
    expect(occupancyPercent({ taken: -2, total: 4 })).toBe(0)
  })
})

describe('occupancyLevel', () => {
  it('is open while there is real room', () => {
    expect(occupancyLevel({ taken: 0, total: 12 })).toBe('open')
    expect(occupancyLevel({ taken: 8, total: 12 })).toBe('open')
  })

  it('is busy from three quarters on', () => {
    expect(occupancyLevel({ taken: 9, total: 12 })).toBe('busy')
    expect(occupancyLevel({ taken: 3, total: 4 })).toBe('busy')
  })

  it('is full when the seats are gone', () => {
    expect(occupancyLevel({ taken: 4, total: 4 })).toBe('full')
    expect(occupancyLevel({ taken: 5, total: 4 })).toBe('full')
  })

  it('is full for a day that can seat nobody', () => {
    // Such a day is on the calendar because a round is happening on it, not
    // because anything can be booked.
    expect(occupancyLevel({ taken: 0, total: 0 })).toBe('full')
  })
})
