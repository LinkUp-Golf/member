import { describe, it, expect } from 'vitest'
import { uniqueCalendarSlug, normaliseSlug, isSlugTakenError } from '@/lib/ghl/client'
import { GHLError, ErrorCode } from '@/lib/errors/app-error'

// GHL rejects a duplicate calendar slug outright, and a host's venue then
// can't be published. Our slug is the course slug — unique in our database,
// which says nothing about what else is in the GHL account.

describe('uniqueCalendarSlug', () => {
  it('uses the name as given when nothing has claimed it', () => {
    expect(uniqueCalendarSlug('aviara', ['torrey-pines'])).toBe('aviara')
  })

  it('numbers from two, so the first duplicate is not "aviara-1"', () => {
    expect(uniqueCalendarSlug('aviara', ['aviara'])).toBe('aviara-2')
  })

  it('keeps counting past a gap rather than reusing a taken number', () => {
    expect(uniqueCalendarSlug('aviara', ['aviara', 'aviara-2', 'aviara-3'])).toBe('aviara-4')
  })

  it('ignores case and stray formatting in what is already taken', () => {
    // GHL's own slugs come back however they were typed.
    expect(uniqueCalendarSlug('Aviara Golf Club', ['aviara-golf-club'])).toBe('aviara-golf-club-2')
  })

  it('falls back to something unique rather than giving up', () => {
    const taken = ['x', ...Array.from({ length: 60 }, (_, i) => `x-${i + 2}`)]
    const slug = uniqueCalendarSlug('x', taken, 50)
    expect(taken).not.toContain(slug)
    expect(slug.startsWith('x-')).toBe(true)
  })

  it('never returns an empty slug', () => {
    expect(uniqueCalendarSlug('   ', [])).toBe('calendar')
  })
})

describe('normaliseSlug', () => {
  it('produces something safe to put in a URL', () => {
    expect(normaliseSlug('  Aviara Golf Club!  ')).toBe('aviara-golf-club')
    expect(normaliseSlug("O'Neill & Sons")).toBe('o-neill-sons')
  })
})

describe('isSlugTakenError', () => {
  const ghlError = (statusCode: number, message: unknown) =>
    new GHLError('GHL API error', ErrorCode.GHL_UNAVAILABLE, {
      statusCode,
      body: { message },
    })

  it('recognises the rejection that prompted all this', () => {
    expect(isSlugTakenError(ghlError(400, 'Calendar slug is already taken'))).toBe(true)
  })

  it('reads a message GHL sends as an array', () => {
    expect(isSlugTakenError(ghlError(400, ['Calendar slug is already taken']))).toBe(true)
  })

  it('does not mistake another 400 for it', () => {
    // Retrying with a new slug would not help, and would hide the real reason.
    expect(
      isSlugTakenError(ghlError(400, 'appointmentPerSlot must be a number')),
    ).toBe(false)
    expect(isSlugTakenError(ghlError(422, 'Calendar slug is already taken'))).toBe(false)
    expect(isSlugTakenError(new Error('network down'))).toBe(false)
    expect(isSlugTakenError(undefined)).toBe(false)
  })
})

describe('slug collision sources', () => {
  it('counts a widget slug as taken, not just a plain one', () => {
    // A calendar made through the GHL dashboard can carry either, and both
    // live in the same namespace.
    expect(uniqueCalendarSlug('aviara', [null, 'aviara'])).toBe('aviara-2')
    expect(uniqueCalendarSlug('aviara', ['torrey', 'aviara', undefined])).toBe('aviara-2')
  })
})
