import { describe, it, expect } from 'vitest'
import { availabilityRules } from '@/lib/hosts/schedule'
import { GHL_CALENDAR_RULES } from '@/lib/constants'

// A host's venue calendar is staffed by their GHL user, and a GHL user is free
// every weekday all day until told otherwise. These rules are what narrows that
// to the tee times the host actually listed — so an off-by-one here doesn't
// error, it quietly sells a tee time nobody is there for.

const SLOT = GHL_CALENDAR_RULES.slotDuration

describe('availabilityRules', () => {
  it('turns a tee time into an interval one slot long', () => {
    expect(availabilityRules([{ date: '2026-07-23', teeTime: '13:30' }], SLOT)).toEqual([
      { type: 'date', date: '2026-07-23', intervals: [{ from: '13:30', to: '13:50' }] },
    ])
  })

  it('groups a date once, however many rounds are on it', () => {
    const rules = availabilityRules(
      [
        { date: '2026-07-23', teeTime: '15:00' },
        { date: '2026-07-23', teeTime: '13:30' },
      ],
      SLOT,
    )

    expect(rules).toHaveLength(1)
    expect(rules[0]?.intervals).toEqual([
      { from: '13:30', to: '13:50' },
      { from: '15:00', to: '15:20' },
    ])
  })

  it('drops a duplicate listing rather than holding the slot twice', () => {
    const rules = availabilityRules(
      [
        { date: '2026-07-23', teeTime: '13:30' },
        { date: '2026-07-23', teeTime: '13:30' },
      ],
      SLOT,
    )
    expect(rules[0]?.intervals).toEqual([{ from: '13:30', to: '13:50' }])
  })

  it('sorts dates, so the same rounds always produce the same payload', () => {
    const rules = availabilityRules(
      [
        { date: '2026-08-01', teeTime: '13:30' },
        { date: '2026-07-23', teeTime: '13:30' },
      ],
      SLOT,
    )
    expect(rules.map(r => r.date)).toEqual(['2026-07-23', '2026-08-01'])
  })

  it('leaves out a round with no usable tee time', () => {
    // The opposite of roundWindow, which treats the same row as the whole day.
    // There the question is "might this collide" and the cautious answer is yes;
    // here it's "what may a member book", where opening the day would sell tee
    // times that don't exist.
    expect(
      availabilityRules(
        [
          { date: '2026-07-23', teeTime: null },
          { date: '2026-07-24', teeTime: 'Shotgun 9am' },
        ],
        SLOT,
      ),
    ).toEqual([])
  })

  it('normalises what it is given: a padded date and a legacy seconds time', () => {
    expect(
      availabilityRules([{ date: '2026-07-23T00:00:00Z', teeTime: '9:05:00' }], SLOT),
    ).toEqual([
      { type: 'date', date: '2026-07-23', intervals: [{ from: '09:05', to: '09:25' }] },
    ])
  })

  it('never runs an interval into the next day', () => {
    // A date rule has no way to express it, and GHL would read the pair as
    // backwards. Not a real tee time, but the clamp is what stops it being one.
    expect(
      availabilityRules([{ date: '2026-07-23', teeTime: '23:55' }], SLOT)[0]?.intervals,
    ).toEqual([{ from: '23:55', to: '23:59' }])
  })

  it('has nothing to say about an empty list', () => {
    expect(availabilityRules([], SLOT)).toEqual([])
  })
})
