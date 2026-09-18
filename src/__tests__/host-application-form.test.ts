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

// The form speaks in venue cards; the API speaks in course_ids and events that
// name the venue they sit at. This is the translation between them — the seam
// where a whole field was once assembled correctly and then dropped before the
// request, with nothing failing to say so.

const round = (overrides: Partial<RoundFields> = {}): RoundFields => ({
  ...newRound(),
  ...overrides,
})

/** A round at the given dates, every one teeing off at 8:30. */
const filled = (dates: string[]): RoundFields =>
  round({
    dates: dates.map(value => ({ value })),
    tee_times: Object.fromEntries(dates.map(d => [d, '8:30 AM'])),
  })

const COURSE_A = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
const COURSE_B = '5f2504e0-4f89-11d3-9a0c-0305e82c3302'

const form = (overrides: Partial<ApplicationValues> = {}): ApplicationValues => ({
  name: 'Jane Smith',
  existing: [],
  ...overrides,
})

describe('roundStarted', () => {
  it('is false for an untouched round', () => {
    expect(roundStarted(newRound())).toBe(false)
  })

  it('is true once any field the applicant owns is filled', () => {
    expect(roundStarted(round({ dates: [{ value: '2099-06-01' }] }))).toBe(true)
    expect(roundStarted(round({ tee_times: { '2099-06-01': 'morning' } }))).toBe(true)
    expect(roundStarted(round({ dinner: true }))).toBe(true)
  })

  it('ignores whitespace-only entries', () => {
    expect(
      roundStarted(round({ dates: [{ value: '   ' }], tee_times: { '2099-06-01': '  ' } })),
    ).toBe(false)
  })

  it('is false for a missing round', () => {
    expect(roundStarted(undefined)).toBe(false)
  })
})

describe('roundAt', () => {
  it('reads the round out of whole-form values', () => {
    const values = form({
      existing: [{ courseId: COURSE_A, label: 'Aviara', pending: false, round: filled(['2099-06-01']) }],
    })
    expect(roundAt(values, 'existing', 0)?.tee_times['2099-06-01']).toBe('8:30 AM')
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
    // The venue is shared across them; the tee time is per date.
    expect(new Set(payload.events.map(e => e.venue))).toEqual(new Set([COURSE_A]))
    expect(payload.events.every(e => e.tee_time === '8:30 AM')).toBe(true)
  })

  it('carries the tee time each date was given', () => {
    // The point of asking per date: two days at a club rarely tee off at the
    // same time, and each date becomes its own event row.
    const payload = buildApplicationPayload(
      form({
        existing: [{
          courseId: COURSE_A,
          label: 'Aviara',
          pending: false,
          round: round({
            dates: [{ value: '2099-06-01' }, { value: '2099-06-08' }, { value: '2099-06-15' }],
            tee_times: { '2099-06-01': ' 8:30 AM ', '2099-06-08': 'afternoon' },
          }),
        }],
      }),
    )
    expect(payload.events.map(e => [e.event_date, e.tee_time])).toEqual([
      ['2099-06-01', '8:30 AM'],
      ['2099-06-08', 'afternoon'],
      // Left blank — no fixed time, rather than inheriting a sibling's.
      ['2099-06-15', null],
    ])
  })

  it('sends neither spots nor a guest rate', () => {
    // Both are the server's to set — capacity from what the venue has open that
    // day, the rate from the fixed term — exactly as for an event a host creates
    // directly. They were collected and validated here for a while, then thrown
    // away on arrival; this is the guard against them creeping back.
    const payload = buildApplicationPayload(
      form({
        existing: [{
          courseId: COURSE_A,
          label: 'Aviara',
          pending: false,
          round: filled(['2099-06-01']),
        }],
      }),
    )
    expect(payload.events[0]).not.toHaveProperty('total_spots')
    expect(payload.events[0]).not.toHaveProperty('member_guest_rate')
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

  it('sends a blank tee time as null, not empty string', () => {
    const payload = buildApplicationPayload(
      form({
        existing: [{
          courseId: COURSE_A,
          label: 'Aviara',
          pending: false,
          round: round({ dates: [{ value: '2099-06-01' }] }),
        }],
      }),
    )
    expect(payload.events[0]?.tee_time).toBeNull()
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
        }),
      )
      expect(validateHostApplicationPayload(payload).valid).toBe(true)
    })

    it('is rejected when a round names a venue that is not a course id', () => {
      // Hosting is offered at listed venues only. A round pointing anywhere but
      // a real course id has to fail rather than be quietly created.
      const payload = buildApplicationPayload(
        form({ existing: [{ courseId: COURSE_A, label: 'Aviara', pending: false, round: filled(['2099-06-01']) }] }),
      )
      const tampered = { ...payload, events: payload.events.map(e => ({ ...e, venue: 'new:0' })) }
      expect(validateHostApplicationPayload(tampered).valid).toBe(false)
    })

    it('is rejected when no venue was chosen', () => {
      expect(validateHostApplicationPayload(buildApplicationPayload(form())).valid).toBe(false)
    })
  })
})
