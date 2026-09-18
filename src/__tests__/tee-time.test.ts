import { describe, it, expect } from 'vitest'
import { isTeeTime, missingTeeTimes, normaliseTeeTime } from '@/lib/hosts/tee-time'

// A tee time is picked with <input type="time">, so it's a clock value and every
// date a host picks has to carry one. These lock the two halves of that: what
// counts as a time of day, and the shape it's stored and shown in. Rows written
// when this was free text ("Shotgun 9am") are the reason the second half is not
// just a trim — the input can't show them, so they read as unset.

describe('isTeeTime', () => {
  it('accepts a clock value, with or without a leading zero or seconds', () => {
    expect(isTeeTime('08:30')).toBe(true)
    expect(isTeeTime('8:30')).toBe(true)
    expect(isTeeTime('13:05:00')).toBe(true)
    expect(isTeeTime(' 08:30 ')).toBe(true)
    expect(isTeeTime('00:00')).toBe(true)
    expect(isTeeTime('23:59')).toBe(true)
  })

  it('refuses free text, which is what hosts used to type', () => {
    expect(isTeeTime('8:30 AM')).toBe(false)
    expect(isTeeTime('Shotgun 9am')).toBe(false)
    expect(isTeeTime('morning')).toBe(false)
  })

  it('refuses a time that does not exist, or nothing at all', () => {
    expect(isTeeTime('24:00')).toBe(false)
    expect(isTeeTime('08:60')).toBe(false)
    expect(isTeeTime('')).toBe(false)
    expect(isTeeTime(null)).toBe(false)
    expect(isTeeTime(undefined)).toBe(false)
    expect(isTeeTime(830)).toBe(false)
  })
})

describe('normaliseTeeTime', () => {
  it('gives the shape the input emits and accepts', () => {
    expect(normaliseTeeTime('8:30')).toBe('08:30')
    expect(normaliseTeeTime(' 13:05:00 ')).toBe('13:05')
    expect(normaliseTeeTime('08:30')).toBe('08:30')
  })

  it('reads anything the input cannot show as unset', () => {
    expect(normaliseTeeTime('Shotgun 9am')).toBe('')
    expect(normaliseTeeTime('')).toBe('')
    expect(normaliseTeeTime(null)).toBe('')
  })
})

describe('missingTeeTimes', () => {
  const dates = ['2099-06-01', '2099-06-08']

  it('names the dates still without one', () => {
    expect(missingTeeTimes(dates, { '2099-06-01': '08:30' })).toEqual(['2099-06-08'])
    expect(missingTeeTimes(dates, { '2099-06-01': '08:30', '2099-06-08': '  ' }))
      .toEqual(['2099-06-08'])
    // A legacy free-text time counts as missing: it has to be picked again.
    expect(missingTeeTimes(dates, { '2099-06-01': 'morning', '2099-06-08': '13:05' }))
      .toEqual(['2099-06-01'])
  })

  it('is empty when every date has one, and when there are no dates', () => {
    expect(missingTeeTimes(dates, { '2099-06-01': '08:30', '2099-06-08': '13:05' })).toEqual([])
    expect(missingTeeTimes([], {})).toEqual([])
    // Times left over from dates since dropped don't make it incomplete.
    expect(missingTeeTimes([], { '2099-06-01': '' })).toEqual([])
  })

  it('treats a missing map as every date missing', () => {
    expect(missingTeeTimes(dates, undefined)).toEqual(dates)
  })
})
