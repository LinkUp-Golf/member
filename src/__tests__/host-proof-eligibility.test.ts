import { describe, it, expect } from 'vitest'
import { canUploadProof, proofState } from '@/lib/hosts/events'

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

// proofState is the answer to "has a proof been sent, and what do we say about
// it" — a question the status alone cannot answer, which is how the button came
// to read "Upload proof" over an event that already had one.

describe('proofState', () => {
  const today = '2026-08-14'
  const state = (over: Partial<Parameters<typeof proofState>[0]> = {}) =>
    proofState({ status: 'completed', eventDate: '2026-08-01', hasProof: false, today, ...over })

  it('labels the button by whether a proof exists, not by status', () => {
    // The reported bug: a same-day upload leaves the event 'upcoming', so any
    // label derived from status alone keeps saying "Upload proof" forever.
    expect(state({ status: 'upcoming', eventDate: today, hasProof: false }).label).toBe('Upload proof')
    expect(state({ status: 'upcoming', eventDate: today, hasProof: true }).label).toBe('Replace proof')
    expect(state({ status: 'pending_credit_approval', hasProof: true }).label).toBe('Replace proof')
  })

  it('confirms a same-day submission on a still-live event', () => {
    const s = state({ status: 'upcoming', eventDate: today, hasProof: true })
    expect(s.note?.tone).toBe('sent')
    expect(s.note?.text).toMatch(/closes out/)
    // Still replaceable — the round is over, the listing just hasn't closed.
    expect(s.canUpload).toBe(true)
  })

  it('says a proof is awaiting the credit decision, and can still be swapped', () => {
    const s = state({ status: 'pending_credit_approval', hasProof: true })
    expect(s.note?.tone).toBe('pending')
    expect(s.note?.text).toMatch(/still replace/)
  })

  it('surfaces a rejection reason on an event sent back to completed', () => {
    // Rejecting returns the event to 'completed', which is otherwise identical
    // to never having uploaded — the reason is the only thing that tells them.
    const s = state({ status: 'completed', hasProof: true, rejectionReason: 'Photo is too dark' })
    expect(s.note?.tone).toBe('rejected')
    expect(s.note?.text).toBe('Proof not accepted: Photo is too dark')
    expect(s.canUpload).toBe(true)
  })

  it('ignores a blank rejection reason', () => {
    expect(state({ status: 'completed', hasProof: true, rejectionReason: '   ' }).note?.tone).toBe('sent')
  })

  it('says nothing when nothing has been sent', () => {
    expect(state({ status: 'completed', hasProof: false }).note).toBeNull()
  })

  it('says nothing once the credit is settled or the event is off', () => {
    expect(state({ status: 'credits_awarded', hasProof: true }).note).toBeNull()
    expect(state({ status: 'credits_awarded', hasProof: true }).canUpload).toBe(false)
    expect(state({ status: 'cancelled', hasProof: true }).note).toBeNull()
    expect(state({ status: 'cancelled', hasProof: true }).canUpload).toBe(false)
  })

  it('offers no upload on an event that has not happened yet', () => {
    const s = state({ status: 'upcoming', eventDate: '2026-08-15', hasProof: false })
    expect(s.canUpload).toBe(false)
    expect(s.note).toBeNull()
  })
})
