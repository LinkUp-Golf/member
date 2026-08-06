import { describe, it, expect } from 'vitest'
import { summarizeCredits } from '@/lib/credits'
import { memberPrice, canUploadProof } from '@/lib/hosts/events'
import { HOST_MEMBER_PRICE_MARKUP_USD } from '@/lib/constants'

describe('summarizeCredits', () => {
  it('is all zeros with no entries', () => {
    expect(summarizeCredits([])).toEqual({ earned: 0, redeemed: 0, balance: 0 })
  })

  it('sums earned and redeemed (redeemed reported positive)', () => {
    const s = summarizeCredits([{ amount: 100 }, { amount: -30 }])
    expect(s).toEqual({ earned: 100, redeemed: 30, balance: 70 })
  })

  it('splits adjustments by sign', () => {
    // +100 earned, -30 redeemed, +10 positive adj, -5 negative adj
    const s = summarizeCredits([{ amount: 100 }, { amount: -30 }, { amount: 10 }, { amount: -5 }])
    expect(s.earned).toBe(110)
    expect(s.redeemed).toBe(35)
    expect(s.balance).toBe(75)
  })

  it('is float-safe when summing cents', () => {
    const s = summarizeCredits([{ amount: 0.1 }, { amount: 0.2 }])
    expect(s.earned).toBe(0.3)
    expect(s.balance).toBe(0.3)
  })
})

describe('memberPrice', () => {
  it('adds the fixed markup to the guest rate', () => {
    expect(memberPrice(50)).toBe(50 + HOST_MEMBER_PRICE_MARKUP_USD)
    expect(memberPrice(0)).toBe(HOST_MEMBER_PRICE_MARKUP_USD)
  })

  it('keeps cents clean', () => {
    expect(memberPrice(49.99)).toBe(59.99)
  })
})

describe('canUploadProof', () => {
  const TODAY = '2026-07-21'

  it('allows it once the event has run', () => {
    expect(canUploadProof('completed', '2026-07-01', TODAY)).toBe(true)
    // Replacing proof already submitted.
    expect(canUploadProof('pending_credit_approval', '2026-07-01', TODAY)).toBe(true)
  })

  it('allows it on the event day without waiting for the completion cron', () => {
    expect(canUploadProof('upcoming', TODAY, TODAY)).toBe(true)
    // And after, if the cron hasn't caught up yet.
    expect(canUploadProof('upcoming', '2026-07-20', TODAY)).toBe(true)
  })

  it('refuses it before the event has happened', () => {
    expect(canUploadProof('upcoming', '2026-07-22', TODAY)).toBe(false)
  })

  it('refuses it once the event is settled or called off', () => {
    expect(canUploadProof('cancelled', '2026-07-01', TODAY)).toBe(false)
    expect(canUploadProof('credits_awarded', '2026-07-01', TODAY)).toBe(false)
  })
})
