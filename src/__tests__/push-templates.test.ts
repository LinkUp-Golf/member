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
