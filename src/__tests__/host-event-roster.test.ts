import { describe, it, expect } from 'vitest'
import { rosterFor } from '@/lib/hosts/events'

// Who the host sees on a round, and in what order. Two ways onto the same
// afternoon — reserving through the event, or booking the venue that day — merge
// into one list of faces, so the rules that keep one person from appearing twice
// are what these lock.

const card = (first: string, last = 'Fields', avatar: string | null = null) => ({
  first_name: first,
  last_name: last,
  avatar_url: avatar,
})

const attendee = (id: string, first: string, teeTime: string | null = '13:30') => ({
  member_id: id,
  first_name: first,
  last_name: 'Fields',
  avatar_url: null,
  tee_time: teeTime,
})

describe('rosterFor', () => {
  it('lists reservations first, then members who only booked the venue', () => {
    const roster = rosterFor(
      ['m1'],
      new Map([['m1', card('Ana')]]),
      [attendee('m2', 'Ben')],
    )
    expect(roster.map(p => [p.first_name, p.source])).toEqual([
      ['Ana', 'reserved'],
      ['Ben', 'booking'],
    ])
  })

  it('counts someone who reserved and also booked once, as a reservation', () => {
    // Also the round's headcount: the host row shows players.length, not
    // filled_spots + booked_spots, which would say three people are coming to a
    // round two people are coming to — and then draw two faces beside it.
    const roster = rosterFor(
      ['m1'],
      new Map([['m1', card('Ana')]]),
      [attendee('m1', 'Ana'), attendee('m2', 'Ben')],
    )
    expect(roster).toHaveLength(2)
    expect(roster.find(p => p.member_id === 'm1')?.source).toBe('reserved')
  })

  it('carries the avatar through, and leaves it null when there is none', () => {
    const roster = rosterFor(
      ['m1'],
      new Map([['m1', card('Ana', 'Fields', 'https://cdn.example/a.jpg')]]),
      [attendee('m2', 'Ben')],
    )
    expect(roster[0]?.avatar_url).toBe('https://cdn.example/a.jpg')
    expect(roster[1]?.avatar_url).toBeNull()
  })

  it('drops a reserved member whose card is missing rather than showing a blank', () => {
    // The count beside the faces comes from filled_spots, not from this list, so
    // a member the lookup missed costs a face and not the number.
    const roster = rosterFor(['m1', 'ghost'], new Map([['m1', card('Ana')]]), [])
    expect(roster.map(p => p.member_id)).toEqual(['m1'])
  })

  it('never repeats a member, however many times they appear on either side', () => {
    const roster = rosterFor(
      ['m1', 'm1'],
      new Map([['m1', card('Ana')]]),
      [attendee('m2', 'Ben', '08:00'), attendee('m2', 'Ben', '13:30')],
    )
    expect(roster.map(p => p.member_id)).toEqual(['m1', 'm2'])
  })

  it('is empty when nobody is on the round', () => {
    expect(rosterFor([], new Map(), [])).toEqual([])
  })
})

// Who actually came. The host ticks it after the round, against the same roster,
// and the tick has to survive both ways onto the list — a member who reserved and
// a member who only booked the venue were at the same round.
describe('rosterFor — attendance', () => {
  it('marks whoever the host ticked, on either side of the list', () => {
    const roster = rosterFor(
      ['m1'],
      new Map([['m1', card('Ana')]]),
      [attendee('m2', 'Ben'), attendee('m3', 'Cal')],
      new Set(['m1', 'm3']),
    )
    expect(roster.map(p => [p.member_id, p.attended])).toEqual([
      ['m1', true],
      ['m2', false],
      ['m3', true],
    ])
  })

  it('reads an unticked name as not attended rather than as unknown', () => {
    // There is no third state on the row: a name with no tick is somebody nobody
    // has said anything about, and the host's job is to tick who played.
    const roster = rosterFor(['m1'], new Map([['m1', card('Ana')]]), [], new Set())
    expect(roster[0]?.attended).toBe(false)
  })

  it('says nobody attended when attendance was not asked for', () => {
    // The member-facing endpoints don't load it, and `undefined` must not read
    // as "present" on a screen that shows a tick.
    const roster = rosterFor(['m1'], new Map([['m1', card('Ana')]]), [])
    expect(roster[0]?.attended).toBe(false)
  })

  it('ignores a tick for somebody who is not on the round', () => {
    // The route filters these out before saving; if one ever got in, it must not
    // put a stranger on the roster.
    const roster = rosterFor(
      ['m1'],
      new Map([['m1', card('Ana')]]),
      [],
      new Set(['m1', 'someone-else']),
    )
    expect(roster.map(p => p.member_id)).toEqual(['m1'])
  })

  it('marks a member who both reserved and booked once', () => {
    const roster = rosterFor(
      ['m1'],
      new Map([['m1', card('Ana')]]),
      [attendee('m1', 'Ana')],
      new Set(['m1']),
    )
    expect(roster).toHaveLength(1)
    expect(roster[0]).toMatchObject({ source: 'reserved', attended: true })
  })
})
