import { describe, it, expect } from 'vitest'
import {
  validateProposedClub,
  validateHostApplicationPayload,
  parseVenueRef,
} from '@/lib/validation'

// The host application form, the hosted-event new-club path and
// POST /api/courses/request all describe the same thing — a club that isn't on
// LinkUp yet. They used to enforce three different rules, so the same club
// proposed from two places produced two different rows. These lock the shared
// contract, including the one difference that is deliberate (requireWebsite).

describe('validateProposedClub', () => {
  it('accepts a name on its own when the website is optional', () => {
    expect(validateProposedClub({ name: 'Torrey Pines' }).valid).toBe(true)
  })

  it('accepts a name with a valid website', () => {
    const r = validateProposedClub({ name: 'Torrey Pines', website: 'https://torreypines.com' })
    expect(r.valid).toBe(true)
  })

  it('rejects a name shorter than two characters', () => {
    expect(validateProposedClub({ name: 'A' }).valid).toBe(false)
  })

  it('rejects a name over 120 characters', () => {
    // The event route previously had no upper bound while the other two capped
    // at 120, so an over-long name was accepted from one entry point only.
    expect(validateProposedClub({ name: 'x'.repeat(121) }).valid).toBe(false)
  })

  it('rejects a malformed website even when one is optional', () => {
    expect(validateProposedClub({ name: 'Torrey Pines', website: 'torreypines.com' }).valid).toBe(false)
  })

  it('rejects a website over 200 characters', () => {
    const long = `https://${'x'.repeat(200)}.com`
    expect(validateProposedClub({ name: 'Torrey Pines', website: long }).valid).toBe(false)
  })

  it('treats a blank website as absent rather than malformed', () => {
    expect(validateProposedClub({ name: 'Torrey Pines', website: '   ' }).valid).toBe(true)
  })

  it('requires a website when the caller asks for one', () => {
    const r = validateProposedClub({ name: 'Torrey Pines' }, { requireWebsite: true })
    expect(r.valid).toBe(false)
    expect(r.errors[0]).toMatch(/website/i)
  })

  it('still accepts a valid website when one is required', () => {
    const r = validateProposedClub(
      { name: 'Torrey Pines', website: 'https://torreypines.com' },
      { requireWebsite: true },
    )
    expect(r.valid).toBe(true)
  })

  it('rejects a non-object payload', () => {
    expect(validateProposedClub(null).valid).toBe(false)
    expect(validateProposedClub('Torrey Pines').valid).toBe(false)
  })
})

describe('validateHostApplicationPayload', () => {
  const base = {
    name: 'Jane Smith',
    course_ids: ['3f2504e0-4f89-11d3-9a0c-0305e82c3301'],
  }

  it('accepts a well-formed application', () => {
    expect(validateHostApplicationPayload(base).valid).toBe(true)
  })

  it('requires at least one venue', () => {
    expect(validateHostApplicationPayload({ ...base, course_ids: [] }).valid).toBe(false)
  })

  it('rejects a non-UUID venue id', () => {
    // The approval route trusts these ids in an `.in()` filter, so a malformed
    // one must not get as far as Postgres.
    expect(validateHostApplicationPayload({ ...base, course_ids: ['not-a-uuid'] }).valid).toBe(false)
  })

  it('rejects more than 50 venues', () => {
    const many = Array.from({ length: 51 }, () => '3f2504e0-4f89-11d3-9a0c-0305e82c3301')
    expect(validateHostApplicationPayload({ ...base, course_ids: many }).valid).toBe(false)
  })

  // The form stopped asking for a description — an admin reviews the venues and
  // the rounds proposed at them. The field is still accepted so a client that
  // hasn't reloaded doesn't have its submission rejected.
  describe('description', () => {
    it('is not required', () => {
      expect(validateHostApplicationPayload(base).valid).toBe(true)
    })

    it('accepts one of any length up to the cap', () => {
      expect(validateHostApplicationPayload({ ...base, description: 'short' }).valid).toBe(true)
      expect(validateHostApplicationPayload({ ...base, description: 'x'.repeat(1000) }).valid).toBe(true)
    })

    it('still rejects one over 1000 characters', () => {
      expect(validateHostApplicationPayload({ ...base, description: 'x'.repeat(1001) }).valid).toBe(false)
    })

    it('treats a blank description as absent', () => {
      expect(validateHostApplicationPayload({ ...base, description: '   ' }).valid).toBe(true)
    })
  })

  // Rounds proposed with the application become real hosted_events on approval,
  // so they're held to the event form's rules here — a proposal that passes must
  // not be able to fail at creation time.
  describe('proposed rounds', () => {
    // `venue` rather than `course_id`: a round may sit at an existing course or at
    // a club created by this same request, which has no id yet.
    const round = {
      venue: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
      event_date: '2099-06-01',
      tee_time: '8:30 AM',
      total_spots: 4,
      member_guest_rate: 150,
      dinner: false,
    }

    it('accepts an application with no rounds at all', () => {
      expect(validateHostApplicationPayload(base).valid).toBe(true)
      expect(validateHostApplicationPayload({ ...base, events: [] }).valid).toBe(true)
    })

    it('accepts well-formed rounds', () => {
      expect(validateHostApplicationPayload({ ...base, events: [round] }).valid).toBe(true)
    })

    it('rejects a non-array events value', () => {
      expect(validateHostApplicationPayload({ ...base, events: 'nope' }).valid).toBe(false)
    })

    it('rejects more than 20 rounds', () => {
      const many = Array.from({ length: 21 }, () => round)
      expect(validateHostApplicationPayload({ ...base, events: many }).valid).toBe(false)
    })

    it('rejects a round with spots outside 1-200', () => {
      expect(validateHostApplicationPayload({ ...base, events: [{ ...round, total_spots: 0 }] }).valid).toBe(false)
      expect(validateHostApplicationPayload({ ...base, events: [{ ...round, total_spots: 201 }] }).valid).toBe(false)
    })

    it('rejects a negative guest rate but allows zero', () => {
      expect(validateHostApplicationPayload({ ...base, events: [{ ...round, member_guest_rate: -1 }] }).valid).toBe(false)
      expect(validateHostApplicationPayload({ ...base, events: [{ ...round, member_guest_rate: 0 }] }).valid).toBe(true)
    })

    it('rejects a malformed date', () => {
      expect(validateHostApplicationPayload({ ...base, events: [{ ...round, event_date: '06/01/2099' }] }).valid).toBe(false)
    })

    it('allows a round with no tee time', () => {
      expect(validateHostApplicationPayload({ ...base, events: [{ ...round, tee_time: null }] }).valid).toBe(true)
    })

    it('names which round failed so a list stays actionable', () => {
      const result = validateHostApplicationPayload({
        ...base,
        events: [round, { ...round, total_spots: 0 }],
      })
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toMatch(/^Round 2:/)
    })

    it('rejects a round with no venue', () => {
      const { venue: _venue, ...noVenue } = round
      expect(validateHostApplicationPayload({ ...base, events: [noVenue] }).valid).toBe(false)
    })
  })

  // Hosting is offered at venues already on LinkUp. An application naming a club
  // we don't have used to create a pending course on submission; that path is
  // gone, so a payload carrying one has nothing valid to point a round at.
  describe('venues must already exist', () => {
    it('rejects an application with no existing venue chosen', () => {
      expect(validateHostApplicationPayload({
        name: 'Jane Smith',
        new_venues: [{ name: 'Torrey Pines', website: 'https://torreypines.com' }],
      }).valid).toBe(false)
    })

    it('ignores a stray new_venues field rather than honouring it', () => {
      const r = validateHostApplicationPayload({
        name: 'Jane Smith',
        course_ids: base.course_ids,
        new_venues: [{ name: 'Torrey Pines' }],
      })
      expect(r.valid).toBe(true)
    })
  })
})

describe('parseVenueRef', () => {
  const uuid = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'

  it('reads a UUID as an existing course', () => {
    expect(parseVenueRef(uuid)).toEqual({ courseId: uuid })
  })

  it('rejects a missing or non-string ref', () => {
    expect(parseVenueRef(undefined).error).toBeTruthy()
    expect(parseVenueRef('').error).toBeTruthy()
    expect(parseVenueRef(42).error).toBeTruthy()
  })

  it('rejects anything that is not a course id', () => {
    // Hosting is offered at listed venues only, so the `new:<index>` reference
    // an applicant's unlisted club used to carry is no longer a valid venue.
    expect(parseVenueRef('not-a-uuid').error).toBeTruthy()
    expect(parseVenueRef('new:0').error).toBeTruthy()
  })
})
