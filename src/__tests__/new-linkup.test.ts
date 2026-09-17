import { describe, it, expect } from 'vitest'
import {
  emptyNewLinkup,
  newLinkupRounds,
  newLinkupStarted,
  validateNewLinkup,
  type NewLinkupValues,
} from '@/lib/hosts/new-linkup'
import { buildApplicationPayload, withNewLinkup } from '@/lib/hosts/application-form'
import { validateHostApplicationPayload } from '@/lib/validation'

// A New LinkUp is asked in two places — the host event drawer's tab and the
// become-a-host application — from one set of rules. These lock what counts as
// filled in, what's required, and how it reaches the application's request.

const filled = (over: Partial<NewLinkupValues> = {}): NewLinkupValues => ({
  ...emptyNewLinkup(),
  name: 'Rancho Santa Fe',
  dates: ['2099-06-08', '2099-06-01'],
  teeTimes: { '2099-06-01': ' 8:30 AM ', '2099-06-08': '' },
  guests: '12',
  rate: '150',
  ...over,
})

const COURSE = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
const LISTED = '5f2504e0-4f89-11d3-9a0c-0305e82c3302'

describe('newLinkupStarted', () => {
  it('is false for an untouched New LinkUp, even with its default payment option', () => {
    expect(newLinkupStarted(emptyNewLinkup())).toBe(false)
  })

  it('is true once anything the applicant types is in', () => {
    expect(newLinkupStarted({ ...emptyNewLinkup(), name: 'R' })).toBe(true)
    expect(newLinkupStarted({ ...emptyNewLinkup(), dates: ['2099-06-01'] })).toBe(true)
    expect(newLinkupStarted({ ...emptyNewLinkup(), guests: '4' })).toBe(true)
  })
})

describe('validateNewLinkup', () => {
  it('accepts a complete one with no website', () => {
    expect(validateNewLinkup(filled())).toEqual({})
  })

  it('requires everything but the website', () => {
    const errors = validateNewLinkup(emptyNewLinkup())
    expect(Object.keys(errors).sort()).toEqual(['dates', 'guests', 'name', 'rate'])
  })

  it('holds the number of guests to a whole number from 1 to 200', () => {
    expect(validateNewLinkup(filled({ guests: '0' })).guests).toBeDefined()
    expect(validateNewLinkup(filled({ guests: '2.5' })).guests).toBeDefined()
    expect(validateNewLinkup(filled({ guests: '201' })).guests).toBeDefined()
    expect(validateNewLinkup(filled({ guests: '200' })).guests).toBeUndefined()
  })

  it('refuses a website that is not a URL, but not a blank one', () => {
    expect(validateNewLinkup(filled({ website: 'ranchosantafe.com' })).website).toBeDefined()
    expect(validateNewLinkup(filled({ website: '  ' })).website).toBeUndefined()
  })
})

describe('newLinkupRounds', () => {
  it('makes one round per date, in order, each with its own tee time', () => {
    expect(newLinkupRounds(filled())).toEqual([
      { event_date: '2099-06-01', tee_time: '8:30 AM', total_spots: 12, member_guest_rate: 150, dinner: false },
      { event_date: '2099-06-08', tee_time: null, total_spots: 12, member_guest_rate: 150, dinner: false },
    ])
  })
})

describe('withNewLinkup', () => {
  const base = buildApplicationPayload({ name: 'Jane Smith', existing: [] })

  it('adds the proposed club as a venue with a round per date', () => {
    const payload = withNewLinkup(base, COURSE, filled())
    expect(payload.course_ids).toEqual([COURSE])
    expect(payload.events.map(e => [e.venue, e.event_date, e.total_spots])).toEqual([
      [COURSE, '2099-06-01', 12],
      [COURSE, '2099-06-08', 12],
    ])
  })

  it('keeps venues already on the application, without naming one twice', () => {
    const withListed = { ...base, course_ids: [LISTED, COURSE] }
    expect(withNewLinkup(withListed, COURSE, filled()).course_ids).toEqual([LISTED, COURSE])
  })

  it('produces a body the application validator accepts', () => {
    expect(validateHostApplicationPayload(withNewLinkup(base, COURSE, filled())).valid).toBe(true)
  })
})
