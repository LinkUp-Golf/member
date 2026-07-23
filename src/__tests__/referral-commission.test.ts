import { describe, it, expect } from 'vitest'
import {
  monthlyCommission,
  accruedMonths,
  memberAccruals,
  computeBalance,
  type AccruingMember,
} from '@/lib/referral-commission'
import { MEMBERSHIP_FEE_USD, COMMISSION_TERM_MONTHS, PAYOUT_THRESHOLD_USD } from '@/lib/constants'

describe('monthlyCommission', () => {
  it('is percentage of the membership fee', () => {
    expect(monthlyCommission(10)).toBe(MEMBERSHIP_FEE_USD * 0.1) // $10
    expect(monthlyCommission(0)).toBe(0)
    expect(monthlyCommission(100)).toBe(MEMBERSHIP_FEE_USD)
  })

  it('snaps to whole cents', () => {
    // 33.33% of $100 = $33.33
    expect(monthlyCommission(33.33)).toBe(33.33)
  })
})

describe('accruedMonths', () => {
  const today = '2026-07-15'

  it('counts one month for a membership that started this month', () => {
    expect(accruedMonths({ startDate: '2026-07-01', today })).toBe(1)
  })

  it('counts each month up to and including the current month', () => {
    // Jan..Jul inclusive = 7 months
    expect(accruedMonths({ startDate: '2026-01-10', today })).toBe(7)
  })

  it('never accrues a future month', () => {
    expect(accruedMonths({ startDate: '2026-09-01', today })).toBe(0)
  })

  it('caps at the 12-month term', () => {
    // started 2 years ago — only 12 months earn
    expect(accruedMonths({ startDate: '2024-07-01', today })).toBe(COMMISSION_TERM_MONTHS)
  })

  it('stops at the cancellation month, inclusive', () => {
    // Jan start, cancelled in March → Jan, Feb, Mar = 3
    expect(accruedMonths({ startDate: '2026-01-05', endDate: '2026-03-20', today })).toBe(3)
  })

  it('earns one month when started and cancelled in the same month', () => {
    expect(accruedMonths({ startDate: '2026-02-01', endDate: '2026-02-25', today })).toBe(1)
  })

  it('respects the partner rate expiry (endsAt)', () => {
    // Jan start, rate expires end of Feb → Jan, Feb = 2 (even though active through Jul)
    expect(accruedMonths({ startDate: '2026-01-01', today, endsAt: '2026-02-28' })).toBe(2)
  })

  it('applies the tightest of term, cancellation, expiry, and today', () => {
    // started long ago, cancelled recently, but term caps at 12
    expect(accruedMonths({ startDate: '2023-01-01', endDate: '2026-06-30', today })).toBe(COMMISSION_TERM_MONTHS)
  })
})

describe('memberAccruals', () => {
  const today = '2026-07-15'
  const members: AccruingMember[] = [
    { linkId: 'a', memberId: '1', email: 'a@x.com', name: 'A', startDate: '2026-06-01', endDate: null }, // Jun,Jul = 2mo
    { linkId: 'b', memberId: '2', email: 'b@x.com', name: 'B', startDate: '2026-05-01', endDate: '2026-05-20' }, // May = 1mo
  ]

  it('prices each member by their active months at the monthly rate', () => {
    const [a, b] = memberAccruals(members, 10, today)
    expect(a!.months).toBe(2)
    expect(a!.accrued).toBe(20) // 2 × $10
    expect(b!.months).toBe(1)
    expect(b!.accrued).toBe(10) // 1 × $10
  })
})

describe('computeBalance', () => {
  it('outstanding is accrued minus paid', () => {
    const b = computeBalance(120, 40)
    expect(b.outstanding).toBe(80)
  })

  it('is payable only once the threshold is reached', () => {
    expect(computeBalance(PAYOUT_THRESHOLD_USD - 1, 0).payable).toBe(false)
    expect(computeBalance(PAYOUT_THRESHOLD_USD, 0).payable).toBe(true)
    expect(computeBalance(250, 160).payable).toBe(false) // outstanding 90 < 100
    expect(computeBalance(250, 140).payable).toBe(true)  // outstanding 110 >= 100
  })

  it('can go negative when paid ahead', () => {
    expect(computeBalance(100, 130).outstanding).toBe(-30)
    expect(computeBalance(100, 130).payable).toBe(false)
  })
})
