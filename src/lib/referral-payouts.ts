// ============================================================
// LinkUp Golf — Referral commission payouts
// Server-side only. Groups a partner's conversions into calendar months and
// works out which months are still owed.
//
// Commission is paid monthly and by hand, once per month per partner. A
// conversion belongs to the month the referral became a member
// (membership_start_date), so someone who joined in March lands in March's
// payout even if the link was recorded later. Conversions outside the partner's
// rate window carry commission 0 and are excluded entirely rather than shown as
// $0 line items.
//
// A paid month is CLOSED: it is rebuilt from the recorded payment and its
// snapshot line items, not from live conversions. So a referral that is linked
// after a month was paid — but whose membership backdates into that month —
// never silently reopens or inflates a settled payout. (Payment is only allowed
// once a month has ended; see the payments route.)
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadPartnerConversions, type PartnerRate, type ReferralConversion } from '@/lib/referral-partners'
import { monthOf, sumCents } from '@/lib/referral-rate'

// Re-exported for server callers that already import from this module.
export { monthOf, formatPeriod } from '@/lib/referral-rate'

type AdminClient = SupabaseClient

/** One line in a payout — a single referral's commission for the period. */
export interface PayoutLineItem {
  /** Referral link id; falls back to the snapshot row id if the link was unlinked. */
  linkId: string
  email: string
  name: string | null
  convertedAt: string
  commission: number
}

export interface PayoutPeriod {
  /** First day of the month being paid, YYYY-MM-DD (2026-07-01 = July 2026). */
  periodMonth: string
  conversions: PayoutLineItem[]
  /** Commission for the month. For a paid month this is the frozen figure the
   *  payment was calculated from, not a live recomputation. */
  total: number
  /** True once a payment row exists for this partner and month. */
  paid: boolean
  paymentId: string | null
  /** What was actually paid, when it differs from the calculated total. */
  paidAmount: number | null
  paidAt: string | null
}

export interface PaymentItemRow {
  id: string
  payment_id: string
  link_id: string | null
  email: string
  name: string | null
  converted_at: string
  commission: number
}

const conversionToLineItem = (c: ReferralConversion): PayoutLineItem => ({
  linkId: c.linkId,
  email: c.email,
  name: c.name,
  convertedAt: c.convertedAt,
  commission: c.commission,
})

const itemRowToLineItem = (row: PaymentItemRow): PayoutLineItem => ({
  linkId: row.link_id ?? row.id,
  email: row.email,
  name: row.name,
  convertedAt: row.converted_at,
  commission: Number(row.commission),
})

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
 * Group conversions into monthly payout periods, newest first.
 *
 * Unpaid months are computed live from `conversions`. Paid months are CLOSED —
 * rebuilt from the recorded payment and its `itemsByPayment` snapshot, ignoring
 * live conversions for that month entirely. A conversion that backdates into an
 * already-paid month is therefore dropped from the payout rather than reopening
 * it or inflating what was settled.
 */
export function buildPayoutPeriods(
  conversions: ReferralConversion[],
  payments: PartnerPaymentRow[],
  itemsByPayment: Map<string, PaymentItemRow[]> = new Map()
): PayoutPeriod[] {
  const paymentByMonth = new Map(payments.map(p => [p.period_month.slice(0, 10), p]))

  // Unpaid months, computed live. Conversions falling in a paid (closed) month
  // are skipped — that month is served from its snapshot below.
  const byMonth = new Map<string, PayoutLineItem[]>()
  for (const c of conversions) {
    // A conversion priced at 0 fell outside the rate term — it earns nothing,
    // so it isn't part of any payout.
    if (!c.withinRateWindow) continue
    const month = monthOf(c.convertedAt)
    if (paymentByMonth.has(month)) continue
    const bucket = byMonth.get(month)
    if (bucket) bucket.push(conversionToLineItem(c))
    else byMonth.set(month, [conversionToLineItem(c)])
  }

  const outstanding: PayoutPeriod[] = [...byMonth.entries()].map(([periodMonth, items]) => ({
    periodMonth,
    conversions: items,
    total: sumCents(items.map(i => i.commission)),
    paid: false,
    paymentId: null,
    paidAmount: null,
    paidAt: null,
  }))

  // Paid months, frozen to what was recorded. The line items are the snapshot
  // taken at payout time; the total is the figure that payment was calculated
  // from, so a later backdated referral can't rewrite it.
  const settled: PayoutPeriod[] = [...paymentByMonth.entries()].map(([periodMonth, payment]) => ({
    periodMonth,
    conversions: (itemsByPayment.get(payment.id) ?? []).map(itemRowToLineItem),
    total: Number(payment.calculated_amount),
    paid: true,
    paymentId: payment.id,
    paidAmount: Number(payment.amount),
    paidAt: payment.paid_at,
  }))

  return [...outstanding, ...settled].sort((a, b) => b.periodMonth.localeCompare(a.periodMonth))
}

/** Load the snapshot line items for a set of payments, grouped by payment id. */
export async function loadPaymentItems(
  admin: AdminClient,
  paymentIds: string[]
): Promise<Map<string, PaymentItemRow[]>> {
  const grouped = new Map<string, PaymentItemRow[]>()
  if (paymentIds.length === 0) return grouped

  const { data } = await admin
    .from('referral_partner_payment_items')
    .select('*')
    .in('payment_id', paymentIds)
    .order('converted_at', { ascending: true })

  for (const row of (data ?? []) as PaymentItemRow[]) {
    const bucket = grouped.get(row.payment_id)
    if (bucket) bucket.push(row)
    else grouped.set(row.payment_id, [row])
  }
  return grouped
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

  const itemsByPayment = await loadPaymentItems(admin, payments.map(p => p.id))
  const periods = buildPayoutPeriods(conversions.get(partner.id) ?? [], payments, itemsByPayment)

  return {
    periods,
    payments,
    totalPaid: sumCents(payments.map(p => Number(p.amount))),
    totalOutstanding: sumCents(periods.filter(p => !p.paid).map(p => p.total)),
  }
}
