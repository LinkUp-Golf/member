import { describe, it, expect } from 'vitest'
import { proofReminderDueAt, isProofReminderDue } from '@/lib/hosts/proof-reminder'

const LA = 'America/Los_Angeles'

describe('proofReminderDueAt', () => {
  it('is 20 minutes after tee time in the venue timezone', () => {
    // 13:30 PDT on 2026-10-08 is 20:30 UTC; +20 min.
    expect(proofReminderDueAt('2026-10-08', '13:30', LA)?.toISOString()).toBe('2026-10-08T20:50:00.000Z')
  })

  it('accepts legacy HH:MM:SS clock values', () => {
    expect(proofReminderDueAt('2026-10-08', '13:30:00', LA)?.toISOString()).toBe('2026-10-08T20:50:00.000Z')
  })

  it('is null for a round with no clock tee time', () => {
    expect(proofReminderDueAt('2026-10-08', null, LA)).toBeNull()
    expect(proofReminderDueAt('2026-10-08', 'Shotgun 9am', LA)).toBeNull()
  })
})

describe('isProofReminderDue', () => {
  const event = { event_date: '2026-10-08', tee_time: '13:30' }

  it('is not due before tee time + 20', () => {
    expect(isProofReminderDue(event, LA, new Date('2026-10-08T20:49:59Z'))).toBe(false)
  })

  it('is due from tee time + 20 on', () => {
    expect(isProofReminderDue(event, LA, new Date('2026-10-08T20:50:00Z'))).toBe(true)
    expect(isProofReminderDue(event, LA, new Date('2026-10-09T02:00:00Z'))).toBe(true)
  })

  it('is never due without a tee time', () => {
    expect(isProofReminderDue({ ...event, tee_time: null }, LA, new Date('2026-10-10T00:00:00Z'))).toBe(false)
  })
})
