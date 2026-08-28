import { describe, it, expect, vi } from 'vitest'

// Keep the module import isolated from any real Supabase client construction.
vi.mock('@/lib/supabase-server', () => ({
  createAdminClient: vi.fn(),
}))

import { NotificationTemplates } from '@/lib/push'

describe('NotificationTemplates.nonMemberBookingRequest', () => {
  it('builds an admin-facing payload that links to the booking-requests queue', () => {
    const payload = NotificationTemplates.nonMemberBookingRequest(
      'Jane Doe',
      2,
      'Monday, June 15',
      '08:30',
    )

    expect(payload.title).toBe('Non-member booking request')
    expect(payload.body).toContain('Jane Doe')
    expect(payload.body).toContain('2 non-members')
    expect(payload.body).toContain('Monday, June 15')
    expect(payload.body).toContain('08:30')
    expect(payload.url).toBe('/admin/booking-requests')
    expect(payload.tag).toBe('booking-request')
  })

  it('uses singular wording for a single non-member', () => {
    const payload = NotificationTemplates.nonMemberBookingRequest(
      'Sam Lee',
      1,
      'Tuesday, June 16',
      '14:00',
    )

    expect(payload.body).toContain('1 non-member ')
    expect(payload.body).not.toContain('1 non-members')
  })
})

describe('NotificationTemplates non-member booking decisions', () => {
  it('builds a booker-facing approval payload', () => {
    const payload = NotificationTemplates.nonMemberBookingApproved('Jane Doe', 'Monday, June 15', '08:30')

    expect(payload.title).toBe('Guest approved')
    expect(payload.body).toContain('Jane Doe')
    expect(payload.body).toContain('Monday, June 15')
    expect(payload.body).toContain('08:30')
    expect(payload.url).toBe('/book')
  })

  it('builds a booker-facing rejection payload', () => {
    const payload = NotificationTemplates.nonMemberBookingRejected('Jane Doe', 'Monday, June 15', '08:30')

    expect(payload.title).toBe('Guest request declined')
    expect(payload.body).toContain('Jane Doe')
    expect(payload.url).toBe('/book')
  })
})

// A venue going live is news to the host who asked for it, and the dates that
// couldn't go live with it are news they have to act on. Both were silent until
// the approval cascade started sending them.

describe('NotificationTemplates.venueApproved', () => {
  it('tells the host the venue is ready to list at', () => {
    const payload = NotificationTemplates.venueApproved('Torrey Pines')

    expect(payload.title).toBe('Your venue is live')
    expect(payload.body).toContain('Torrey Pines')
    expect(payload.body).toContain('list rounds')
    expect(payload.url).toBe('/host/events')
    expect(payload.tag).toBe('venue-approved')
  })
})

describe('NotificationTemplates.hostedEventDatesHeld', () => {
  it('reads as one date in the singular', () => {
    const payload = NotificationTemplates.hostedEventDatesHeld('Torrey Pines', 1)

    expect(payload.title).toBe('One date needs changing')
    expect(payload.body).toContain('Torrey Pines')
    expect(payload.body).toContain('the date you asked for')
    expect(payload.body).not.toContain('1 of the dates')
  })

  it('counts them when there are several', () => {
    const payload = NotificationTemplates.hostedEventDatesHeld('Torrey Pines', 3)

    expect(payload.title).toBe('3 dates need changing')
    expect(payload.body).toContain('3 of the dates')
  })

  it('says the venue is live either way — that half is good news', () => {
    for (const count of [1, 4]) {
      expect(NotificationTemplates.hostedEventDatesHeld('Aviara', count).body).toContain('is live')
    }
  })

  it('sends the host somewhere they can act', () => {
    const payload = NotificationTemplates.hostedEventDatesHeld('Aviara', 2)
    expect(payload.url).toBe('/host/events')
    expect(payload.tag).toBe('hosted-event-dates-held')
  })
})
