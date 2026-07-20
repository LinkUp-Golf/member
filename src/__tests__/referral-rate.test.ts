import { describe, it, expect } from 'vitest'
import { commissionForRate, isWithinRateWindow, isRateExpired, sumCents } from '@/lib/referral-rate'
import { MEMBERSHIP_FEE_USD } from '@/lib/constants'

describe('commissionForRate', () => {
  it('takes the percentage of the membership fee', () => {
    expect(commissionForRate(10)).toBe(MEMBERSHIP_FEE_USD * 0.1)
    expect(commissionForRate(0)).toBe(0)
    expect(commissionForRate(100)).toBe(MEMBERSHIP_FEE_USD)
  })

  it('accepts a numeric string (numeric columns come back as strings)', () => {
    expect(commissionForRate('12.5' as unknown as number)).toBe(MEMBERSHIP_FEE_USD * 0.125)
  })

  it('rounds to whole cents', () => {
    // 33.33% of $100 = $33.33, cleanly, not 33.329999…
    expect(commissionForRate(33.33)).toBe(33.33)
  })
})

describe('sumCents', () => {
  it('sums without binary-float drift', () => {
    // Three lines that would otherwise land on 99.99000000000001.
    expect(sumCents([33.33, 33.33, 33.33])).toBe(99.99)
  })

  it('is exact across many lines', () => {
    expect(sumCents(Array(10).fill(12.5))).toBe(125)
  })

  it('returns 0 for an empty set', () => {
    expect(sumCents([])).toBe(0)
  })
})

describe('isWithinRateWindow', () => {
  it('treats a missing expiry as an open-ended rate', () => {
    expect(isWithinRateWindow('2030-01-01', null)).toBe(true)
    expect(isWithinRateWindow('2030-01-01', undefined)).toBe(true)
  })

  it('includes the expiry date itself', () => {
    expect(isWithinRateWindow('2026-08-12', '2026-08-12')).toBe(true)
  })

  it('excludes conversions after the expiry', () => {
    expect(isWithinRateWindow('2026-08-13', '2026-08-12')).toBe(false)
  })

  it('ignores any time component on either side', () => {
    expect(isWithinRateWindow('2026-08-12T23:59:59Z', '2026-08-12T00:00:00Z')).toBe(true)
  })
})

describe('isRateExpired', () => {
  const today = new Date('2026-07-19T12:00:00Z')

  it('is false without an expiry', () => {
    expect(isRateExpired(null, today)).toBe(false)
  })

  it('is false on the expiry date — the rate is honoured through end of day', () => {
    expect(isRateExpired('2026-07-19', today)).toBe(false)
  })

  it('is true the day after', () => {
    expect(isRateExpired('2026-07-18', today)).toBe(true)
  })

  it('is false for a future expiry', () => {
    expect(isRateExpired('2026-12-31', today)).toBe(false)
  })
})
