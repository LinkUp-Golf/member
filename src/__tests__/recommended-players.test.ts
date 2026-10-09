import { describe, it, expect } from 'vitest'
import { recommendFromCancelled, pingsRemaining, type CancelledRow } from '@/lib/bookings/recommended-players'

const ME = 'me'
const row = (over: Partial<CancelledRow>): CancelledRow => ({
  member_id: ME,
  player_member_id: null,
  guest_name: null,
  booking_date: '2026-10-01',
  ...over,
})

describe('recommendFromCancelled', () => {
  it('names the members on the booker\'s cancelled rows, never the booker', () => {
    const rows = [
      row({}), // the booker's own seat
      row({ player_member_id: 'a', guest_name: 'A' }),
      row({ player_member_id: 'b', guest_name: 'B' }),
    ]
    expect(recommendFromCancelled(rows, ME, new Set())).toEqual(['a', 'b'])
  })

  it('skips an unlinked non-member guest, who has no member to message', () => {
    expect(recommendFromCancelled([row({ guest_name: 'Pat' })], ME, new Set())).toEqual([])
  })

  it('lists the most recent round first, each person once', () => {
    const rows = [
      row({ player_member_id: 'a', guest_name: 'A', booking_date: '2026-09-01' }),
      row({ player_member_id: 'b', guest_name: 'B', booking_date: '2026-10-01' }),
      row({ player_member_id: 'a', guest_name: 'A', booking_date: '2026-10-02' }),
    ]
    expect(recommendFromCancelled(rows, ME, new Set())).toEqual(['a', 'b'])
  })

  it('leaves out anyone already playing that day', () => {
    const rows = [
      row({ player_member_id: 'a', guest_name: 'A' }),
      row({ player_member_id: 'b', guest_name: 'B' }),
    ]
    expect(recommendFromCancelled(rows, ME, new Set(['a']))).toEqual(['b'])
  })
})

describe('pingsRemaining', () => {
  it('never lets waiting pings outnumber the open spots', () => {
    expect(pingsRemaining(3, 0)).toBe(3)
    expect(pingsRemaining(3, 2)).toBe(1)
    expect(pingsRemaining(2, 2)).toBe(0)
    expect(pingsRemaining(1, 4)).toBe(0)
    expect(pingsRemaining(0, 0)).toBe(0)
  })
})
