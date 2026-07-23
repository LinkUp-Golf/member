import { describe, it, expect } from 'vitest'
import { buildPayoutPeriods, type PartnerPaymentRow, type PaymentItemRow } from '@/lib/referral-payouts'
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

function payment(periodMonth: string, amount: number, calculated = amount): PartnerPaymentRow {
  return {
    id: `pay-${periodMonth}`,
    referral_partner_id: 'partner-1',
    period_month: periodMonth,
    calculated_amount: calculated,
    amount,
    conversion_count: 1,
    note: null,
    paid_at: `${periodMonth}T12:00:00Z`,
    paid_by: 'admin-1',
    created_at: `${periodMonth}T12:00:00Z`,
  }
}

function item(paymentId: string, overrides: Partial<PaymentItemRow> = {}): PaymentItemRow {
  return {
    id: `item-${paymentId}-${overrides.email ?? 'a'}`,
    payment_id: paymentId,
    link_id: `link-${overrides.email ?? 'a'}`,
    email: 'a@example.com',
    name: 'A Member',
    converted_at: '2026-03-04',
    commission: 10,
    ...overrides,
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

  it('surfaces an adjusted payment amount alongside the frozen calculated total', () => {
    // Calculated $10, but only $7.50 was actually paid.
    const periods = buildPayoutPeriods(
      [conversion({ convertedAt: '2026-03-04' })],
      [payment('2026-03-01', 7.5, 10)]
    )
    expect(periods[0]?.total).toBe(10)       // frozen figure the payment was calculated from
    expect(periods[0]?.paidAmount).toBe(7.5) // what was actually paid
  })

  it('keeps a paid month in history, frozen to the recorded figure', () => {
    const periods = buildPayoutPeriods([], [payment('2026-03-01', 10)])
    expect(periods).toHaveLength(1)
    expect(periods[0]?.paid).toBe(true)
    expect(periods[0]?.total).toBe(10)
  })

  it('freezes a paid month: a referral backdating into it does not reopen or inflate it', () => {
    // The referral converted in an already-paid March, but was linked later.
    const periods = buildPayoutPeriods(
      [
        conversion({ convertedAt: '2026-03-20', email: 'late@x.com', commission: 999 }),
        conversion({ convertedAt: '2026-04-04', email: 'b@x.com' }),
      ],
      [payment('2026-03-01', 10)]
    )
    const byMonth = Object.fromEntries(periods.map(p => [p.periodMonth, p]))
    // March stays closed at its recorded total; the late $999 is dropped.
    expect(byMonth['2026-03-01']?.paid).toBe(true)
    expect(byMonth['2026-03-01']?.total).toBe(10)
    expect(byMonth['2026-03-01']?.conversions).toEqual([])
    // April is still open and computed live.
    expect(byMonth['2026-04-01']?.paid).toBe(false)
    expect(byMonth['2026-04-01']?.total).toBe(10)
  })

  it('serves a paid month\'s line items from its snapshot, not live conversions', () => {
    const periods = buildPayoutPeriods(
      [conversion({ convertedAt: '2026-03-04', email: 'live@x.com', commission: 999 })],
      [payment('2026-03-01', 20)],
      new Map([['pay-2026-03-01', [
        item('pay-2026-03-01', { email: 'snap1@x.com', commission: 12 }),
        item('pay-2026-03-01', { email: 'snap2@x.com', commission: 8 }),
      ]]])
    )
    expect(periods[0]?.conversions.map(c => c.email)).toEqual(['snap1@x.com', 'snap2@x.com'])
    expect(periods[0]?.total).toBe(20)
  })

  it('returns nothing when there are no conversions and no payments', () => {
    expect(buildPayoutPeriods([], [])).toEqual([])
  })
})
