// ============================================================
// LinkUp Golf — Referral commission payouts
// Server-side only. Groups a partner's conversions into calendar months and
// works out which months are still owed.
//
// Commission is paid monthly and by hand. A conversion belongs to the month
// the referral became a member (membership_start_date), so someone who joined
// in March lands in March's payout even if the link was recorded later.
// Conversions outside the partner's rate window carry commission 0 and are
// excluded entirely rather than shown as $0 line items.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadPartnerConversions, type PartnerRate, type ReferralConversion } from '@/lib/referral-partners'
import { monthOf } from '@/lib/referral-rate'

// Re-exported for server callers that already import from this module.
export { monthOf, formatPeriod } from '@/lib/referral-rate'

type AdminClient = SupabaseClient

export interface PayoutPeriod {
  /** First day of the month being paid, YYYY-MM-DD (2026-07-01 = July 2026). */
  periodMonth: string
  conversions: ReferralConversion[]
  /** Commission owed for the month. */
  total: number
  /** True once a payment row exists for this partner and month. */
  paid: boolean
  paymentId: string | null
  /** What was actually paid, when it differs from the calculated total. */
  paidAmount: number | null
  paidAt: string | null
}

export interface PartnerPaymentRow {
  id: string
  referral_partner_id: string
  period_month: string
  calculated_amount: number
  amount: number
  conversion_count: number
  note: string | null
  paid_at: string
  paid_by: string | null
  created_at: string
}

/**
 * Group conversions into monthly payout periods, newest first, marking each as
 * paid or outstanding against the partner's recorded payments.
 */
export function buildPayoutPeriods(
  conversions: ReferralConversion[],
  payments: PartnerPaymentRow[]
): PayoutPeriod[] {
  const paymentByMonth = new Map(payments.map(p => [p.period_month.slice(0, 10), p]))

  const byMonth = new Map<string, ReferralConversion[]>()
  for (const c of conversions) {
    // A conversion priced at 0 fell outside the rate term — it earns nothing,
    // so it isn't part of any payout.
    if (!c.withinRateWindow) continue
    const month = monthOf(c.convertedAt)
    const bucket = byMonth.get(month)
    if (bucket) bucket.push(c)
    else byMonth.set(month, [c])
  }

  // A month that was paid but whose conversions have since been unlinked still
  // belongs in the history, so seed from payments too.
  for (const month of paymentByMonth.keys()) {
    if (!byMonth.has(month)) byMonth.set(month, [])
  }

  return [...byMonth.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([periodMonth, monthConversions]) => {
      const payment = paymentByMonth.get(periodMonth)
      return {
        periodMonth,
        conversions: monthConversions,
        total: monthConversions.reduce((sum, c) => sum + c.commission, 0),
        paid: !!payment,
        paymentId: payment?.id ?? null,
        paidAmount: payment ? Number(payment.amount) : null,
        paidAt: payment?.paid_at ?? null,
      }
    })
}

/** Load a partner's payment rows, newest period first. */
export async function loadPartnerPayments(
  admin: AdminClient,
  partnerId: string
): Promise<PartnerPaymentRow[]> {
  const { data } = await admin
    .from('referral_partner_payments')
    .select('*')
    .eq('referral_partner_id', partnerId)
    .order('period_month', { ascending: false })
  return (data ?? []) as PartnerPaymentRow[]
}

/**
 * Everything the payouts UI needs for one partner: each month's conversions,
 * what's owed, and what's already been paid.
 */
export async function loadPayoutSummary(
  admin: AdminClient,
  partner: PartnerRate
): Promise<{
  periods: PayoutPeriod[]
  payments: PartnerPaymentRow[]
  totalPaid: number
  totalOutstanding: number
}> {
  const [{ conversions }, payments] = await Promise.all([
    loadPartnerConversions(admin, [partner]),
    loadPartnerPayments(admin, partner.id),
  ])

  const periods = buildPayoutPeriods(conversions.get(partner.id) ?? [], payments)

  return {
    periods,
    payments,
    totalPaid: payments.reduce((sum, p) => sum + Number(p.amount), 0),
    totalOutstanding: periods.filter(p => !p.paid).reduce((sum, p) => sum + p.total, 0),
  }
}
