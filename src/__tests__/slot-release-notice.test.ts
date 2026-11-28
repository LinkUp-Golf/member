import { describe, it, expect } from 'vitest'
import {
  DEFAULT_NOTICE_BODY,
  fillNoticeBody,
  groupTeeTimes,
  invalidEmails,
  isNoticeDue,
  isProductionApp,
  noticeDueAt,
  noticeHostId,
  noticeRecipients,
  noticeSubject,
  parseEmailList,
  parseNoticeNumber,
  unbookedHeldTeeTimes,
  type NoticeSeatRow,
} from '@/lib/venues/slot-release-notice'

// Pacific, in January: UTC-8.
const TZ = 'America/Los_Angeles'

function seat(over: Partial<NoticeSeatRow>): NoticeSeatRow {
  return {
    booking_date: '2027-01-23',
    tee_time: '12:08:00',
    member_id: 'booker',
    player_member_id: null,
    guest_name: null,
    playing_host: false,
    created_at: '2026-12-01T10:00:00Z',
    ...over,
  }
}

describe('when the notice is due', () => {
  it('is 72 hours before the tee time at the venue', () => {
    // 12:08 Pacific on the 23rd is 20:08 UTC; 72 hours earlier is the 20th.
    expect(noticeDueAt('2027-01-23', '12:08:00', TZ, 72).toISOString()).toBe('2027-01-20T20:08:00.000Z')
  })

  it('sends from 8 minutes before to 30 minutes after, and not otherwise', () => {
    const due = (iso: string) => isNoticeDue('2027-01-23', '12:08:00', TZ, 72, new Date(iso))
    expect(due('2027-01-20T19:59:00Z')).toBe(false)
    expect(due('2027-01-20T20:00:00Z')).toBe(true)
    expect(due('2027-01-20T20:38:00Z')).toBe(true)
    expect(due('2027-01-20T20:39:00Z')).toBe(false)
    // A day later — the tee time is 48 hours away — is too late.
    expect(due('2027-01-21T20:08:00Z')).toBe(false)
  })

  it('follows the hours the venue is set to', () => {
    expect(noticeDueAt('2027-01-23', '12:08:00', TZ, 24).toISOString()).toBe('2027-01-22T20:08:00.000Z')
  })
})

describe('groupTeeTimes', () => {
  it('counts every held seat at a tee time, the host and guests included', () => {
    const groups = groupTeeTimes([
      seat({ member_id: 'greg', playing_host: true }),
      seat({}),
      seat({ guest_name: 'Pat Guest' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ date: '2027-01-23', teeTime: '12:08:00', players: 3, hostMemberId: 'greg' })
  })

  it('keeps tee times and days apart, and reads HH:MM as HH:MM:SS', () => {
    const groups = groupTeeTimes([
      seat({ tee_time: '12:08' }),
      seat({ tee_time: '12:08:00' }),
      seat({ tee_time: '13:30:00' }),
      seat({ booking_date: '2027-01-24' }),
    ])
    expect(groups.map(g => [g.date, g.teeTime, g.players])).toEqual([
      ['2027-01-23', '12:08:00', 2],
      ['2027-01-23', '13:30:00', 1],
      ['2027-01-24', '12:08:00', 1],
    ])
  })

  it('skips a row with no tee time', () => {
    expect(groupTeeTimes([seat({ tee_time: null })])).toEqual([])
  })

  it('takes a host seat booked for someone else as that person', () => {
    const [g] = groupTeeTimes([seat({ member_id: 'admin', player_member_id: 'jim', playing_host: true })])
    expect(g!.hostMemberId).toBe('jim')
  })
})

describe('unbookedHeldTeeTimes', () => {
  const booked = groupTeeTimes([seat({ booking_date: '2027-01-23' })])

  it('takes the calendar tee time on a day nobody booked, with the host counted', () => {
    const held = unbookedHeldTeeTimes(booked, { '2027-01-24': ['2027-01-24T12:08:00-08:00'] }, 'greg')
    expect(held).toEqual([
      { date: '2027-01-24', teeTime: '12:08:00', players: 1, hostMemberId: 'greg', firstBookerId: 'greg' },
    ])
    expect(noticeHostId(held[0]!, 'greg')).toBe('greg')
  })

  it('leaves a booked day to its bookings', () => {
    expect(unbookedHeldTeeTimes(booked, { '2027-01-23': ['2027-01-23T13:30:00-08:00'] }, 'greg')).toEqual([])
  })

  it('takes only the first tee time when the calendar offers a range', () => {
    const held = unbookedHeldTeeTimes([], {
      '2027-01-24': ['2027-01-24T13:00:00-08:00', '2027-01-24T12:10:00-08:00', '12:30'],
    }, 'greg')
    expect(held.map(h => h.teeTime)).toEqual(['12:10:00'])
  })

  it('has nothing for a day the calendar offers nothing', () => {
    expect(unbookedHeldTeeTimes([], { '2027-01-24': [] }, 'greg')).toEqual([])
  })

  it('counts nobody where the venue has no playing host', () => {
    const [held] = unbookedHeldTeeTimes([], { '2027-01-24': ['12:08:00'] }, null)
    expect(held!.players).toBe(0)
  })
})

describe('noticeHostId', () => {
  const [group] = groupTeeTimes([
    seat({ member_id: 'later', created_at: '2026-12-02T00:00:00Z' }),
    seat({ member_id: 'first', created_at: '2026-12-01T00:00:00Z' }),
  ])

  it('falls back to the venue host, then the first booker', () => {
    expect(noticeHostId(group!, 'greg')).toBe('greg')
    expect(noticeHostId(group!, null)).toBe('first')
  })

  it('prefers the host seated at that tee time', () => {
    const [seated] = groupTeeTimes([seat({ member_id: 'jim', playing_host: true })])
    expect(noticeHostId(seated!, 'greg')).toBe('jim')
  })
})

describe('the email', () => {
  const values = { hostName: 'Greg Lipper', date: '2027-01-23', teeTime: '12:08:00', players: 3 }

  it('fills the agreed wording', () => {
    const body = fillNoticeBody(null, values)
    expect(body).toContain('This is an automated email from LinkUp Golf.')
    expect(body).toContain(
      'Greg Lipper currently has a foursome booking on Saturday, January 23, 2027 at 12:08 PM. We currently have 3 players confirmed.',
    )
    expect(body).toContain('Aviara may release the remaining slots for individual sign ups.')
    expect(body).not.toMatch(/\[[^\]]+\]/)
  })

  it('fills an edited body, in any case, and leaves unknown brackets alone', () => {
    expect(fillNoticeBody('[HOST NAME] at [Tee Time] [unknown]', values)).toBe('Greg Lipper at 12:08 PM [unknown]')
  })

  it('uses the default when the saved body is blank', () => {
    expect(fillNoticeBody('   ', values)).toBe(fillNoticeBody(DEFAULT_NOTICE_BODY, values))
  })

  it('names the venue, date, time and count in the subject', () => {
    expect(noticeSubject('Park Hyatt Aviara Golf Club', values)).toBe(
      'LinkUp Golf at Park Hyatt Aviara Golf Club: Saturday, January 23, 2027 at 12:08 PM, 3 players confirmed',
    )
    expect(noticeSubject('Aviara', { ...values, players: 1 })).toContain('1 player confirmed')
  })

  it('shows an afternoon time as PM', () => {
    expect(fillNoticeBody('[tee time]', { ...values, teeTime: '13:30:00' })).toBe('1:30 PM')
  })
})

describe('recipients', () => {
  it('writes to the club, copied, only in production', () => {
    expect(noticeRecipients(['shop@club.com'], ['greg@linkup.golf'], true)).toEqual({
      to: ['shop@club.com'], cc: ['greg@linkup.golf'], heldBack: false,
    })
  })

  it('sends only the copy anywhere else', () => {
    expect(noticeRecipients(['shop@club.com'], ['greg@linkup.golf'], false)).toEqual({
      to: ['greg@linkup.golf'], cc: [], heldBack: true,
    })
    expect(noticeRecipients(['shop@club.com'], [], false).to).toEqual([])
  })

  it('knows production by its address alone', () => {
    expect(isProductionApp('https://app.linkup.golf')).toBe(true)
    expect(isProductionApp('https://app.linkup.golf/')).toBe(true)
    expect(isProductionApp('https://app-dev.linkup.golf')).toBe(false)
    expect(isProductionApp('http://localhost:3000')).toBe(false)
    expect(isProductionApp(undefined)).toBe(false)
  })

  it('parses a list of addresses and reports the bad ones', () => {
    expect(parseEmailList('a@x.com, b@y.com;A@x.com  nope')).toEqual(['a@x.com', 'b@y.com'])
    expect(invalidEmails('a@x.com, nope')).toEqual(['nope'])
    expect(parseEmailList(null)).toEqual([])
  })
})

describe('parseNoticeNumber', () => {
  it('takes whole numbers in range, from a number or a string', () => {
    expect(parseNoticeNumber(72, 1, 720)).toBe(72)
    expect(parseNoticeNumber('4', 1, 100)).toBe(4)
    expect(parseNoticeNumber(0, 1, 100)).toBeNull()
    expect(parseNoticeNumber(2.5, 1, 100)).toBeNull()
    expect(parseNoticeNumber('', 1, 100)).toBeNull()
  })
})
