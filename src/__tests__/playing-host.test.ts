import { describe, expect, it } from 'vitest'
import { showsCalendarHost } from '@/lib/bookings/playing-host'

describe('showsCalendarHost', () => {
  it('drops the calendar host line at a venue with a playing host', () => {
    // Aviara: the host is on the sheet as a player, not as "Greg 2" above it.
    expect(showsCalendarHost({ playing_host_member_id: 'b0f4c7a2-0000-4000-8000-000000000001' })).toBe(false)
  })

  it('keeps it everywhere else', () => {
    expect(showsCalendarHost({ playing_host_member_id: null })).toBe(true)
    expect(showsCalendarHost({})).toBe(true)
  })
})
