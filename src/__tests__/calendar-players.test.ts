import { describe, it, expect } from 'vitest'
import { groupPlayersByDay, playingMemberId } from '@/lib/bookings/players'

// "Who's playing" on the /book calendar is built from booking rows, which come
// in three shapes: a booker's own row, a member invited onto someone else's
// booking, and a non-member guest. Getting the person wrong shows the booker
// twice and the invitee not at all, so these lock which member a row seats.

const BOOKER = 'booker-id'
const INVITEE = 'invitee-id'
const COURSE = 'course-id'

describe('playingMemberId', () => {
  it("seats the booker on their own row", () => {
    expect(playingMemberId({ member_id: BOOKER, player_member_id: null, guest_name: null })).toBe(BOOKER)
  })

  it('seats the invited member, not the booker, on an invite row', () => {
    expect(
      playingMemberId({ member_id: BOOKER, player_member_id: INVITEE, guest_name: 'Jo Invitee' }),
    ).toBe(INVITEE)
  })

  it('seats nobody for a non-member guest — there is no profile to show', () => {
    expect(
      playingMemberId({ member_id: BOOKER, player_member_id: null, guest_name: 'Sam Guest' }),
    ).toBeNull()
  })
})

describe('groupPlayersByDay', () => {
  const members = new Map([
    [BOOKER, { firstName: 'Bea', lastName: 'Booker', avatarUrl: null }],
    [INVITEE, { firstName: 'Ian', lastName: 'Invitee', avatarUrl: 'https://x/y.png' }],
  ])
  const row = (over: Partial<Parameters<typeof groupPlayersByDay>[0][number]>) => ({
    member_id: BOOKER,
    player_member_id: null,
    guest_name: null,
    course_id: COURSE,
    booking_date: '2026-09-20',
    tee_time: '09:00:00',
    ...over,
  })

  it('groups by day, orders by tee time, and marks the caller', () => {
    const days = groupPlayersByDay(
      [
        row({ tee_time: '11:00:00' }),
        row({ player_member_id: INVITEE, guest_name: 'Ian Invitee', tee_time: '08:00:00' }),
        row({ booking_date: '2026-09-21' }),
      ],
      members,
      BOOKER,
    )

    expect(Object.keys(days).sort()).toEqual(['2026-09-20', '2026-09-21'])
    expect(days['2026-09-20']?.map((p) => [p.memberId, p.teeTime, p.isSelf])).toEqual([
      [INVITEE, '08:00:00', false],
      [BOOKER, '11:00:00', true],
    ])
  })

  it('drops a duplicate row for the same member at the same tee time', () => {
    const days = groupPlayersByDay([row({}), row({})], members, 'someone-else')
    expect(days['2026-09-20']).toHaveLength(1)
  })

  it('leaves out guests and members it has no details for', () => {
    const days = groupPlayersByDay(
      [row({ guest_name: 'Sam Guest' }), row({ member_id: 'unknown-member' })],
      members,
      BOOKER,
    )
    expect(days).toEqual({})
  })
})
