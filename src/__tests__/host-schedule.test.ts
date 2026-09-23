import { describe, it, expect } from 'vitest'
import {
  FALLBACK_ROUND_MINUTES,
  describeRoundConflict,
  findRoundConflicts,
  roundWindow,
  windowsOverlap,
  type ExistingRound,
} from '@/lib/hosts/schedule'

// Two hosts on the same tee sheet is only visible once a calendar has been
// created over the top of one of them, so these are the rules that have to hold
// before that happens: what block of the day a round takes up, when two blocks
// collide, and that a set being approved is checked against itself as well as
// against what's already on the books.

const existing = (over: Partial<ExistingRound> = {}): ExistingRound => ({
  eventId: 'e1',
  hostId: 'h1',
  hostName: 'Dana',
  date: '2026-10-01',
  teeTime: '09:00',
  ...over,
})

describe('roundWindow', () => {
  it('runs from the tee time for the venue’s round length', () => {
    expect(roundWindow({ date: '2026-10-01', teeTime: '09:30' }, 240)).toEqual({
      date: '2026-10-01',
      startMins: 9 * 60 + 30,
      endMins: 9 * 60 + 30 + 240,
      wholeDay: false,
    })
  })

  it('falls back to a standard round when the venue gives no duration', () => {
    const window = roundWindow({ date: '2026-10-01', teeTime: '08:00' }, 0)
    expect(window.endMins - window.startMins).toBe(FALLBACK_ROUND_MINUTES)
  })

  it('takes the whole day when there is no tee time to schedule around', () => {
    // Legacy rows only — every round created since tee times became required
    // carries one. Flagging the day is the cautious answer, not a guess.
    expect(roundWindow({ date: '2026-10-01', teeTime: null }, 240)).toMatchObject({
      startMins: 0,
      endMins: 1440,
      wholeDay: true,
    })
  })
})

describe('windowsOverlap', () => {
  const day = '2026-10-01'

  it('is false on different days, whatever the times', () => {
    expect(
      windowsOverlap(
        roundWindow({ date: day, teeTime: '09:00' }, 240),
        roundWindow({ date: '2026-10-02', teeTime: '09:00' }, 240),
      ),
    ).toBe(false)
  })

  it('is true when one round starts inside another', () => {
    expect(
      windowsOverlap(
        roundWindow({ date: day, teeTime: '09:00' }, 240),
        roundWindow({ date: day, teeTime: '11:00' }, 240),
      ),
    ).toBe(true)
  })

  it('is false for a round that tees off exactly as the last one ends', () => {
    // The following group, not a double-booking.
    expect(
      windowsOverlap(
        roundWindow({ date: day, teeTime: '09:00' }, 240),
        roundWindow({ date: day, teeTime: '13:00' }, 240),
      ),
    ).toBe(false)
  })
})

describe('findRoundConflicts', () => {
  it('passes a set that clears everything already on the books', () => {
    expect(
      findRoundConflicts(
        [{ date: '2026-10-01', teeTime: '14:00' }],
        [existing({ teeTime: '09:00' })],
        240,
      ),
    ).toEqual([])
  })

  it('names the round it runs into', () => {
    const conflicts = findRoundConflicts(
      [{ date: '2026-10-01', teeTime: '10:00' }],
      [existing({ teeTime: '09:00', hostName: 'Dana' })],
      240,
    )
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.existing.hostName).toBe('Dana')
  })

  it('checks a proposed set against itself', () => {
    // An application carrying two rounds at one club, or two hosts waiting on
    // the same venue's first calendar: neither round exists yet, so nothing
    // else would catch it.
    const conflicts = findRoundConflicts(
      [
        { date: '2026-10-01', teeTime: '09:00' },
        { date: '2026-10-01', teeTime: '10:00' },
      ],
      [],
      240,
    )
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.round.teeTime).toBe('10:00')
  })

  it('does not report a round already on the books clashing with itself', () => {
    const row = existing({ eventId: 'same' })
    expect(findRoundConflicts([{ ...row }], [row], 240)).toEqual([])
  })

  it('treats a round with no tee time as holding the day', () => {
    expect(
      findRoundConflicts(
        [{ date: '2026-10-01', teeTime: '18:00' }],
        [existing({ teeTime: null })],
        240,
      ),
    ).toHaveLength(1)
  })
})

describe('describeRoundConflict', () => {
  it('says the date, the time and whose round it is', () => {
    const conflicts = findRoundConflicts(
      [{ date: '2026-10-01', teeTime: '10:00' }],
      [existing({ teeTime: '09:00', hostName: 'Dana' })],
      240,
    )
    const conflict = conflicts[0]
    expect(conflict).toBeDefined()
    const message = describeRoundConflict(conflict as NonNullable<typeof conflict>, 'Aviara')
    expect(message).toContain('2026-10-01 at 10:00')
    expect(message).toContain('Dana')
    expect(message).toContain('Aviara')
    expect(message).toContain('09:00')
  })
})
