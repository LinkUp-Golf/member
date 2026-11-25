import { describe, expect, it } from 'vitest'
import { GROUP_TABLE_MIN_TEE_TIMES, offersGroupTable, teeTimesOnDay } from '@/lib/bookings/group-table'

describe('teeTimesOnDay', () => {
  it('counts one foursome once, however many seats are booked on it', () => {
    expect(teeTimesOnDay(['08:00:00', '08:00:00', '08:00:00'], [])).toBe(1)
  })

  it('counts a tee time that is booked and still open once', () => {
    expect(teeTimesOnDay(['08:00:00'], ['08:00:00'])).toBe(1)
  })

  it('treats HH:MM and HH:MM:SS as the same tee time', () => {
    expect(teeTimesOnDay(['8:00'], ['08:00:00'])).toBe(1)
  })

  it('counts a full tee time GHL no longer lists, beside an open one', () => {
    expect(teeTimesOnDay(['08:00:00', '08:00:00', '08:00:00', '08:00:00'], ['08:10:00'])).toBe(2)
  })

  it('counts two open tee times nobody has booked yet', () => {
    expect(teeTimesOnDay([], ['08:00:00', '08:10:00'])).toBe(2)
  })

  it('ignores blanks', () => {
    expect(teeTimesOnDay(['', '  '], [])).toBe(0)
  })
})

describe('offersGroupTable', () => {
  it('is not offered for a single foursome', () => {
    expect(offersGroupTable(1)).toBe(false)
    expect(offersGroupTable(0)).toBe(false)
  })

  it('is offered from two foursomes up', () => {
    expect(GROUP_TABLE_MIN_TEE_TIMES).toBe(2)
    expect(offersGroupTable(2)).toBe(true)
    expect(offersGroupTable(5)).toBe(true)
  })
})
