import { describe, it, expect } from 'vitest'
import { summarizeCredits } from '@/lib/credits'
import { memberPrice, hostMarkup, canUploadProof } from '@/lib/hosts/events'
import { HOST_EVENT_GUEST_RATE_USD, HOST_MEMBER_PRICE_MARKUP_PERCENT } from '@/lib/constants'

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

describe('hostMarkup', () => {
  it('takes its percentage of the guest rate', () => {
    expect(hostMarkup(100)).toBe(HOST_MEMBER_PRICE_MARKUP_PERCENT)
    expect(hostMarkup(HOST_EVENT_GUEST_RATE_USD)).toBe(7.5)
  })

  it('is nothing on a free round', () => {
    // A percentage fee scales to zero where a flat one didn't — a host
    // listing a round at no cost shouldn't put a price on it.
    expect(hostMarkup(0)).toBe(0)
  })

  it('rounds to the cent rather than carrying a fraction of one', () => {
    // 49.99 * 5% = 2.4995 — the half-cent has to go somewhere, and it can't
    // survive into a figure quoted on a screen.
    expect(hostMarkup(49.99)).toBe(2.5)
  })
})

describe('memberPrice', () => {
  it('adds the markup to the guest rate', () => {
    expect(memberPrice(100)).toBe(105)
    expect(memberPrice(HOST_EVENT_GUEST_RATE_USD)).toBe(157.5)
  })

  it('is the guest rate itself when there is no rate to take a cut of', () => {
    expect(memberPrice(0)).toBe(0)
  })

  it('keeps cents clean', () => {
    expect(memberPrice(49.99)).toBe(52.49)
  })

  it('always equals the rate plus the quoted markup', () => {
    // The two are shown side by side, so a rounding rule that let them
    // disagree by a cent would be visible.
    for (const rate of [0, 1, 33.33, 49.99, 150, 999.95]) {
      expect(memberPrice(rate)).toBe(Math.round((rate + hostMarkup(rate)) * 100) / 100)
    }
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
