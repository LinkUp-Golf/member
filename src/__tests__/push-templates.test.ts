import { describe, it, expect, vi } from 'vitest'

// Keep the module import isolated from any real Supabase client construction.
vi.mock('@/lib/supabase-server', () => ({
  createAdminClient: vi.fn(),
}))

import { NotificationTemplates } from '@/lib/push'

describe('NotificationTemplates.nonMemberBookingRequest', () => {
  it('builds an admin-facing payload that links to admin bookings', () => {
    const payload = NotificationTemplates.nonMemberBookingRequest(
      'Jane Doe',
      2,
      'Monday, June 15',
      '08:30',
    )

    expect(payload.title).toBe('Non-member invite request')
    expect(payload.body).toContain('Jane Doe')
    expect(payload.body).toContain('2 non-members')
    expect(payload.body).toContain('Monday, June 15')
    expect(payload.body).toContain('08:30')
    expect(payload.url).toBe('/admin/bookings')
    // Tag maps to the existing 'booking' notification type in notification_log.
    expect(payload.tag).toBe('booking')
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
