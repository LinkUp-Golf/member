import { describe, it, expect } from 'vitest'
import { buildTeeSheet } from '@/lib/bookings/tee-sheet'
import { hostDisplayName } from '@/lib/bookings/venue-hosts'
import type { CalendarPlayer } from '@/lib/bookings/players'
import type { VenueHost } from '@/lib/bookings/venue-hosts'

// The day's tee sheet, as the "who's playing" sheet arranges it: venue, then
// tee time, the host at the head of each. Two of those rules are invisible when
// they go wrong — a host who has also booked appearing twice, and the viewer
// being told a stranger is them — so they're checked here rather than by eye.

const player = (over: Partial<CalendarPlayer> = {}): CalendarPlayer => ({
  memberId: 'dana',
  firstName: 'Dana',
  lastName: 'Okafor',
  avatarUrl: null,
  courseId: 'aviara',
  teeTime: '13:30:00',
  isSelf: false,
  ...over,
})

const host = (over: Partial<VenueHost> = {}): VenueHost => ({
  ghlUserId: 'ghl-1',
  name: 'Ash Delgado',
  memberId: null,
  avatarUrl: null,
  ...over,
})

describe('buildTeeSheet', () => {
  it('groups a venue by tee time', () => {
    const sheets = buildTeeSheet([
      player({ memberId: 'a', teeTime: '13:30:00' }),
      player({ memberId: 'b', teeTime: '13:30:00' }),
      player({ memberId: 'c', teeTime: '13:35:00' }),
    ])
    expect(sheets).toHaveLength(1)
    expect(sheets[0]?.tees.map(t => t.teeTime)).toEqual(['13:30:00', '13:35:00'])
    expect(sheets[0]?.tees[0]?.players.map(p => p.memberId)).toEqual(['a', 'b'])
    expect(sheets[0]?.tees[1]?.players.map(p => p.memberId)).toEqual(['c'])
  })

  it('keeps each venue apart', () => {
    const sheets = buildTeeSheet([
      player({ memberId: 'a', courseId: 'aviara' }),
      player({ memberId: 'b', courseId: 'torrey' }),
    ])
    expect(sheets.map(s => s.courseId)).toEqual(['aviara', 'torrey'])
  })

  it('puts the venue\'s host on every one of its tee times', () => {
    // One host runs the venue, so they're at the head of each group — the same
    // person the member's own booking confirmation names.
    const hosts = new Map([['aviara', host()]])
    const sheets = buildTeeSheet(
      [player({ memberId: 'a', teeTime: '13:30:00' }), player({ memberId: 'b', teeTime: '13:35:00' })],
      hosts,
    )
    expect(sheets[0]?.host?.name).toBe('Ash Delgado')
    expect(sheets[0]?.tees).toHaveLength(2)
  })

  it('leaves a venue hostless rather than inventing one', () => {
    const sheets = buildTeeSheet([player()], new Map([['torrey', host()]]))
    expect(sheets[0]?.host).toBeNull()
  })

  it('does not list a host who has also booked twice', () => {
    // They'd appear once at the head of the group and again inside it.
    const hosts = new Map([['aviara', host({ memberId: 'ash' })]])
    const sheets = buildTeeSheet(
      [player({ memberId: 'ash' }), player({ memberId: 'dana' })],
      hosts,
    )
    expect(sheets[0]?.host?.memberId).toBe('ash')
    expect(sheets[0]?.tees[0]?.players.map(p => p.memberId)).toEqual(['dana'])
  })

  it('filters nobody out for a host who is not one of our members', () => {
    // No member id to match against, so every booking stays in its group.
    const hosts = new Map([['aviara', host({ memberId: null })]])
    const sheets = buildTeeSheet([player({ memberId: 'ash' })], hosts)
    expect(sheets[0]?.tees[0]?.players.map(p => p.memberId)).toEqual(['ash'])
  })

  it('marks the viewer as the host when they are', () => {
    const hosts = new Map([['aviara', host({ memberId: 'ash' })]])
    const sheets = buildTeeSheet([player({ memberId: 'ash', isSelf: true })], hosts)
    expect(sheets[0]?.hostIsSelf).toBe(true)
  })

  it('does not mark someone else as the viewer', () => {
    const hosts = new Map([['aviara', host({ memberId: 'ash' })]])
    const sheets = buildTeeSheet(
      [player({ memberId: 'ash' }), player({ memberId: 'dana', isSelf: true })],
      hosts,
    )
    expect(sheets[0]?.hostIsSelf).toBe(false)
  })

  it('leaves a tee time the host alone is out on', () => {
    // Their booking is the only one at that time; the group is still real.
    const hosts = new Map([['aviara', host({ memberId: 'ash' })]])
    const sheets = buildTeeSheet([player({ memberId: 'ash', teeTime: '06:00:00' })], hosts)
    expect(sheets[0]?.tees[0]?.players).toEqual([])
    expect(sheets[0]?.host?.memberId).toBe('ash')
  })

  it('returns nothing for a day nobody is on', () => {
    expect(buildTeeSheet([], new Map([['aviara', host()]]))).toEqual([])
  })

  it('works with no hosts at all', () => {
    const sheets = buildTeeSheet([player()])
    expect(sheets[0]?.host).toBeNull()
    expect(sheets[0]?.hostIsSelf).toBe(false)
  })
})

describe('hostDisplayName', () => {
  it('prefers the name the host operates under', () => {
    // hosts.name is what their members have seen on the round; the GHL user is
    // whatever the account was created as.
    expect(hostDisplayName("Ash's Golf Days", { firstName: 'Ash', lastName: 'Delgado' })).toBe(
      "Ash's Golf Days",
    )
  })

  it('falls back to the GHL user for someone who is not one of our hosts', () => {
    // A club employee can staff the calendar without being a LinkUp host.
    expect(hostDisplayName(null, { firstName: 'Ash', lastName: 'Delgado' })).toBe('Ash Delgado')
    expect(hostDisplayName('   ', { firstName: 'Ash', lastName: '' })).toBe('Ash')
  })

  it('is empty when neither side can name them, so no host row is shown', () => {
    expect(hostDisplayName(null, undefined)).toBe('')
    expect(hostDisplayName('', { firstName: '', lastName: '' })).toBe('')
  })
})
