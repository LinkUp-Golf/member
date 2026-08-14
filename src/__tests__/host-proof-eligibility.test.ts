import { describe, it, expect } from 'vitest'
import { canUploadProof } from '@/lib/hosts/events'

// canUploadProof gates the proof button and the proof route, so the two can't
// drift. The same-day case is the subtle one: it is deliberately allowed (a host
// shouldn't wait for the nightly completion cron), which is why the proof route
// must not use it as a reason to move an event out of `upcoming` — doing so
// delisted a still-live event mid-day.

describe('canUploadProof', () => {
  const today = '2026-08-14'

  it('allows upload once the event is completed', () => {
    expect(canUploadProof('completed', '2026-08-01', today)).toBe(true)
  })

  it('allows re-upload while awaiting credit approval', () => {
    expect(canUploadProof('pending_credit_approval', '2026-08-01', today)).toBe(true)
  })

  it('allows a same-day upload on a still-upcoming event', () => {
    expect(canUploadProof('upcoming', today, today)).toBe(true)
  })

  it('allows upload for a past event the cron has not yet completed', () => {
    expect(canUploadProof('upcoming', '2026-08-13', today)).toBe(true)
  })

  it('refuses an event still in the future', () => {
    expect(canUploadProof('upcoming', '2026-08-15', today)).toBe(false)
  })

  it('refuses a cancelled event', () => {
    expect(canUploadProof('cancelled', '2026-08-01', today)).toBe(false)
  })

  it('refuses an event already settled', () => {
    expect(canUploadProof('credits_awarded', '2026-08-01', today)).toBe(false)
  })
})
