import { describe, expect, it } from 'vitest'
import { showsCalendarHost } from '@/lib/bookings/playing-host'
import { bookingAmountDue } from '@/lib/bookings/price'

describe('bookingAmountDue for the host seat', () => {
  it('is free, rather than falling back to the venue rate', () => {
    expect(bookingAmountDue({ playing_host: true, amount_charged: 0, cost_per_player: 160 })).toBe(0)
    // Even a booking of the host's own that still carries its old price.
    expect(bookingAmountDue({ playing_host: true, amount_charged: 160, cost_per_player: 160 })).toBe(0)
  })

  it('leaves every other seat priced as before', () => {
    expect(bookingAmountDue({ amount_charged: 0, cost_per_player: 150 })).toBe(150)
  })
})

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
