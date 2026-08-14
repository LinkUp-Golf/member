import { describe, it, expect } from 'vitest'
import {
  buildApplicationPayload,
  newRound,
  roundStarted,
  roundAt,
  type ApplicationValues,
  type RoundFields,
} from '@/lib/hosts/application-form'
import { validateHostApplicationPayload } from '@/lib/validation'

// The form speaks in venue cards; the API speaks in course_ids, new_venues and
// events that name an unlisted club by its index. This is the translation
// between them — the seam where new_venues was once assembled correctly and then
// dropped before the request, with nothing failing to say so.

const round = (overrides: Partial<RoundFields> = {}): RoundFields => ({
  ...newRound(),
  ...overrides,
})

const filled = (dates: string[]): RoundFields =>
  round({
    dates: dates.map(value => ({ value })),
    tee_time: '8:30 AM',
    member_guest_rate: '150',
  })

const COURSE_A = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
const COURSE_B = '5f2504e0-4f89-11d3-9a0c-0305e82c3302'

const form = (overrides: Partial<ApplicationValues> = {}): ApplicationValues => ({
  name: 'Jane Smith',
  existing: [],
  custom: [],
  ...overrides,
})

describe('roundStarted', () => {
  it('is false for an untouched round', () => {
    // total_spots carries a default, so it alone must not count as touched —
    // otherwise every selected venue would demand a full round.
    expect(roundStarted(newRound())).toBe(false)
  })

  it('is true once any field the applicant owns is filled', () => {
    expect(roundStarted(round({ dates: [{ value: '2099-06-01' }] }))).toBe(true)
    expect(roundStarted(round({ tee_time: 'morning' }))).toBe(true)
    expect(roundStarted(round({ member_guest_rate: '0' }))).toBe(true)
    expect(roundStarted(round({ dinner: true }))).toBe(true)
  })

  it('ignores whitespace-only entries', () => {
    expect(roundStarted(round({ dates: [{ value: '   ' }], tee_time: '  ' }))).toBe(false)
  })

  it('is false for a missing round', () => {
    expect(roundStarted(undefined)).toBe(false)
  })
})

describe('roundAt', () => {
  it('reads the round out of whole-form values', () => {
    const values = form({
      custom: [{ name: 'Torrey Pines', website: '', round: filled(['2099-06-01']) }],
    })
    expect(roundAt(values, 'custom', 0)?.member_guest_rate).toBe('150')
  })

  it('returns undefined for an index that is gone', () => {
    // A validate rule can fire against a card that was just removed.
    expect(roundAt(form(), 'existing', 3)).toBeUndefined()
  })
})

describe('buildApplicationPayload', () => {
  it('sends a selected venue with no round as a venue request only', () => {
    const payload = buildApplicationPayload(
      form({ existing: [{ courseId: COURSE_A, label: 'Aviara', pending: false, round: newRound() }] }),
    )
    expect(payload.course_ids).toEqual([COURSE_A])
    expect(payload.events).toEqual([])
  })

  it('expands a round into one event per date', () => {
    const payload = buildApplicationPayload(
      form({
        existing: [{
          courseId: COURSE_A,
          label: 'Aviara',
          pending: false,
          round: filled(['2099-06-01', '2099-06-08', '2099-06-15']),
        }],
      }),
    )
    expect(payload.events).toHaveLength(3)
    expect(payload.events.map(e => e.event_date)).toEqual([
      '2099-06-01', '2099-06-08', '2099-06-15',
    ])
    // Everything but the date is shared across them.
    expect(new Set(payload.events.map(e => e.venue))).toEqual(new Set([COURSE_A]))
    expect(payload.events.every(e => e.member_guest_rate === 150)).toBe(true)
  })

  it('drops blank dates rather than emitting an empty event', () => {
    const payload = buildApplicationPayload(
      form({
        existing: [{
          courseId: COURSE_A,
          label: 'Aviara',
          pending: false,
          round: filled(['2099-06-01', '  ']),
        }],
      }),
    )
    expect(payload.events).toHaveLength(1)
  })

  it('names a new venue by its index in new_venues', () => {
    const payload = buildApplicationPayload(
      form({
        custom: [
          { name: 'Torrey Pines', website: 'https://torreypines.com', round: filled(['2099-06-01']) },
          { name: 'Pebble Beach', website: '', round: filled(['2099-07-01']) },
        ],
      }),
    )
    expect(payload.new_venues.map(v => v.name)).toEqual(['Torrey Pines', 'Pebble Beach'])
    expect(payload.events.map(e => e.venue)).toEqual(['new:0', 'new:1'])
  })

  it('keeps the index aligned when an earlier new venue has no round', () => {
    // The dangerous case: skipping a venue's events must not shift the index
    // of the ones after it, or a round lands at the wrong club.
    const payload = buildApplicationPayload(
      form({
        custom: [
          { name: 'No Dates Yet', website: '', round: newRound() },
          { name: 'Pebble Beach', website: '', round: filled(['2099-07-01']) },
        ],
      }),
    )
    expect(payload.new_venues).toHaveLength(2)
    expect(payload.events).toHaveLength(1)
    expect(payload.events[0]?.venue).toBe('new:1')
    expect(payload.new_venues[1]?.name).toBe('Pebble Beach')
  })

  it('carries both kinds of venue in one submission', () => {
    const payload = buildApplicationPayload(
      form({
        existing: [{ courseId: COURSE_A, label: 'Aviara', pending: false, round: filled(['2099-06-01']) }],
        custom: [{ name: 'Torrey Pines', website: '', round: filled(['2099-07-01']) }],
      }),
    )
    expect(payload.course_ids).toEqual([COURSE_A])
    expect(payload.new_venues).toHaveLength(1)
    expect(payload.events.map(e => e.venue)).toEqual([COURSE_A, 'new:0'])
  })

  it('sends a blank tee time and website as null, not empty string', () => {
    const payload = buildApplicationPayload(
      form({
        custom: [{
          name: '  Torrey Pines  ',
          website: '   ',
          round: round({ dates: [{ value: '2099-06-01' }], member_guest_rate: '0' }),
        }],
      }),
    )
    expect(payload.new_venues[0]).toEqual({ name: 'Torrey Pines', website: null })
    expect(payload.events[0]?.tee_time).toBeNull()
    // 0 is a real rate, not "unset".
    expect(payload.events[0]?.member_guest_rate).toBe(0)
  })

  it('trims the host name', () => {
    expect(buildApplicationPayload(form({ name: '  Jane Smith  ' })).name).toBe('Jane Smith')
  })

  // The payload has to satisfy the server rules, or the form can produce a body
  // that only fails after a round trip.
  describe('agrees with the server validator', () => {
    it('accepts a venues-and-rounds submission', () => {
      const payload = buildApplicationPayload(
        form({
          existing: [
            { courseId: COURSE_A, label: 'Aviara', pending: false, round: filled(['2099-06-01']) },
            { courseId: COURSE_B, label: 'Rancho', pending: false, round: newRound() },
          ],
          custom: [{ name: 'Torrey Pines', website: 'https://torreypines.com', round: filled(['2099-07-01']) }],
        }),
      )
      expect(validateHostApplicationPayload(payload).valid).toBe(true)
    })

    it('accepts a new-venue-only submission', () => {
      const payload = buildApplicationPayload(
        form({ custom: [{ name: 'Torrey Pines', website: '', round: filled(['2099-06-01']) }] }),
      )
      expect(validateHostApplicationPayload(payload).valid).toBe(true)
    })

    it('is rejected when no venue was chosen', () => {
      expect(validateHostApplicationPayload(buildApplicationPayload(form())).valid).toBe(false)
    })
  })
})
