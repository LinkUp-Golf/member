import { describe, it, expect } from 'vitest'
import { dayOccupancy, occupancyLabel, occupancyTally } from '@/lib/bookings/occupancy'

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
