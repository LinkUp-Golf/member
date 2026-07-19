import { describe, it, expect } from 'vitest'
import { buildPayoutPeriods, type PartnerPaymentRow } from '@/lib/referral-payouts'
import type { ReferralConversion } from '@/lib/referral-partners'

function conversion(overrides: Partial<ReferralConversion> & { convertedAt: string }): ReferralConversion {
  return {
    linkId: `link-${overrides.convertedAt}-${overrides.email ?? 'a'}`,
    partnerId: 'partner-1',
    memberId: 'member-1',
    email: 'a@example.com',
    name: 'A Member',
    commission: 10,
    withinRateWindow: true,
    ...overrides,
  }
}

function payment(periodMonth: string, amount: number): PartnerPaymentRow {
  return {
    id: `pay-${periodMonth}`,
    referral_partner_id: 'partner-1',
    period_month: periodMonth,
    calculated_amount: amount,
    amount,
    conversion_count: 1,
    note: null,
    paid_at: `${periodMonth}T12:00:00Z`,
    paid_by: 'admin-1',
    created_at: `${periodMonth}T12:00:00Z`,
  }
}

describe('buildPayoutPeriods', () => {
  it('groups conversions into the month they converted in', () => {
    const periods = buildPayoutPeriods(
      [
        conversion({ convertedAt: '2026-03-04', email: 'a@x.com' }),
        conversion({ convertedAt: '2026-03-28', email: 'b@x.com' }),
        conversion({ convertedAt: '2026-04-01', email: 'c@x.com' }),
      ],
      []
    )

    expect(periods.map(p => p.periodMonth)).toEqual(['2026-04-01', '2026-03-01'])
    expect(periods[0]?.total).toBe(10)
    expect(periods[1]?.total).toBe(20)
    expect(periods[1]?.conversions).toHaveLength(2)
  })

  it('orders periods newest first', () => {
    const periods = buildPayoutPeriods(
      [
        conversion({ convertedAt: '2025-12-10', email: 'a@x.com' }),
        conversion({ convertedAt: '2026-06-10', email: 'b@x.com' }),
        conversion({ convertedAt: '2026-01-10', email: 'c@x.com' }),
      ],
      []
    )
    expect(periods.map(p => p.periodMonth)).toEqual(['2026-06-01', '2026-01-01', '2025-12-01'])
  })

  it('excludes conversions outside the rate window entirely', () => {
    const periods = buildPayoutPeriods(
      [
        conversion({ convertedAt: '2026-03-04', email: 'a@x.com' }),
        conversion({ convertedAt: '2026-03-05', email: 'b@x.com', commission: 0, withinRateWindow: false }),
      ],
      []
    )
    expect(periods).toHaveLength(1)
    expect(periods[0]?.conversions).toHaveLength(1)
    expect(periods[0]?.total).toBe(10)
  })

  it('marks a month paid when a payment exists for it', () => {
    const periods = buildPayoutPeriods(
      [conversion({ convertedAt: '2026-03-04' })],
      [payment('2026-03-01', 10)]
    )
    expect(periods[0]?.paid).toBe(true)
    expect(periods[0]?.paidAmount).toBe(10)
    expect(periods[0]?.paymentId).toBe('pay-2026-03-01')
  })

  it('leaves months without a payment outstanding', () => {
    const periods = buildPayoutPeriods(
      [
        conversion({ convertedAt: '2026-03-04', email: 'a@x.com' }),
        conversion({ convertedAt: '2026-04-04', email: 'b@x.com' }),
      ],
      [payment('2026-03-01', 10)]
    )
    const byMonth = Object.fromEntries(periods.map(p => [p.periodMonth, p]))
    expect(byMonth['2026-03-01']?.paid).toBe(true)
    expect(byMonth['2026-04-01']?.paid).toBe(false)
    expect(byMonth['2026-04-01']?.paidAmount).toBeNull()
  })

  it('surfaces an adjusted payment amount alongside the calculated total', () => {
    const periods = buildPayoutPeriods(
      [conversion({ convertedAt: '2026-03-04' })],
      [payment('2026-03-01', 7.5)]
    )
    expect(periods[0]?.total).toBe(10)     // what was earned
    expect(periods[0]?.paidAmount).toBe(7.5) // what was actually paid
  })

  it('keeps a paid month in history after its conversions are unlinked', () => {
    const periods = buildPayoutPeriods([], [payment('2026-03-01', 10)])
    expect(periods).toHaveLength(1)
    expect(periods[0]?.paid).toBe(true)
    expect(periods[0]?.conversions).toEqual([])
    expect(periods[0]?.total).toBe(0)
  })

  it('returns nothing when there are no conversions and no payments', () => {
    expect(buildPayoutPeriods([], [])).toEqual([])
  })
})
