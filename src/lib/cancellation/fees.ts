// Invoicing a late cancellation.
//
// Three steps, in an order that matters:
//
//   1. recordCancellationFee — before the seat is released. If the record can't
//      be written the cancel route refuses, and nothing has happened; the other
//      order lets a member off free whenever this write fails. The unique index
//      on the seat makes a double tap on Cancel record one fee, not two.
//   2. the route releases the seat; if that fails, discardCancellationFee takes
//      the record back out, since nothing was cancelled.
//   3. invoiceCancellationFee — issues the fee as a Stripe invoice (pay within
//      INVOICE_DAYS_UNTIL_DUE days) and tells the member, push and email, with a
//      link to Stripe's invoice page: they pay there by card and can download
//      the invoice as a PDF. If Stripe can't be reached the fee is still owed
//      and the member still told; the "Pay invoice" button on /more/payments
//      issues it then (feeInvoiceUrl).
//
// The invoice email is ours, not Stripe's (no sendInvoice): it's one message
// in the app's own template, and it arrives in test mode too, where Stripe
// mails nobody. Stripe's page is where the money moves.
//
// Payment is learned from the Stripe webhook (invoice.paid → settleFeePaid),
// which marks the fee paid and sends the member a receipt. Voiding the invoice
// in the Stripe dashboard waives the fee (settleFeeWaived) — that's the admin's
// way to let one go until the app has a screen for it.
//
// Invoicing never fails the cancel. The seat is already given up by then.
//
// Who pays is whoever cancelled: they're the one who decided, and the one who
// was shown the fee before confirming.
//
// Service-role throughout: cancellation_fees has no write policy.

import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'
import { getStripe } from '@/lib/stripe/client'
import { ensureCustomer } from '@/lib/stripe/customers'
import { formatRoundPrice } from '@/lib/bookings/price'
import { NotificationTemplates } from '@/lib/push'
import { notifyMember } from '@/lib/notify'
import { logger } from '@/lib/logger'
import {
  INVOICE_DAYS_UNTIL_DUE,
  feeInvoiceLine,
  invoiceDate,
  toCents,
  type CancellationQuote,
} from './policy'
import type { CancellationFee, CancellationFeeOutcome } from '@/types'

const FEE_COLUMNS =
  'id, member_id, source, booking_id, hosted_event_id, hosted_event_registration_id, course_id, course_name, ' +
  'event_date, tee_time, price, percent, amount, status, failure_reason, paid_at, ' +
  'stripe_invoice_id, invoice_url, invoice_pdf, invoice_number, created_at'

/** The metadata key every Stripe object made for a fee carries. */
export const FEE_METADATA_KEY = 'cancellation_fee_id'

/** A fee as stored, with the invoice id the member-facing type leaves out. */
type FeeRow = CancellationFee & { stripe_invoice_id: string | null }

const asFee = (row: Record<string, unknown>): FeeRow => ({
  ...(row as unknown as FeeRow),
  price: Number(row.price),
  amount: Number(row.amount),
  percent: Number(row.percent),
})

/** Drops the Stripe id before a fee goes to the member's screen. */
function forMember(fee: FeeRow): CancellationFee {
  const { stripe_invoice_id: _id, ...rest } = fee
  return rest
}

const roundName = (fee: { course_name: string | null }) => fee.course_name ?? 'your round'

export type RecordResult =
  | { fee: CancellationFee }
  /** This seat already has a fee — a second tap, or two tabs. */
  | { duplicate: true }
  | { error: string }

export async function recordCancellationFee(
  admin: SupabaseClient,
  input: {
    memberId: string
    source: 'booking' | 'hosted_event'
    bookingId?: string
    hostedEventId?: string
    registrationId?: string
    courseId: string | null
    courseName: string | null
    eventDate: string
    teeTime: string | null
    quote: CancellationQuote
  },
): Promise<RecordResult> {
  const { data, error } = await admin
    .from('cancellation_fees')
    .insert({
      member_id: input.memberId,
      source: input.source,
      booking_id: input.bookingId ?? null,
      hosted_event_id: input.hostedEventId ?? null,
      hosted_event_registration_id: input.registrationId ?? null,
      course_id: input.courseId,
      course_name: input.courseName,
      event_date: input.eventDate,
      tee_time: input.teeTime,
      price: input.quote.price,
      percent: input.quote.percent,
      amount: input.quote.amount,
    })
    .select(FEE_COLUMNS)
    .single()

  if (error) {
    if (error.code === '23505') return { duplicate: true }
    logger.error('Could not record a cancellation fee', {
      action: 'cancellation_fee.record_failed',
      metadata: { member_id: input.memberId, booking_id: input.bookingId, error: error.message },
    })
    return { error: error.message }
  }
  return { fee: forMember(asFee(data as unknown as Record<string, unknown>)) }
}

/** Takes back a fee whose cancellation didn't go through. */
export async function discardCancellationFee(admin: SupabaseClient, feeId: string): Promise<void> {
  await admin.from('cancellation_fees').delete().eq('id', feeId).eq('status', 'pending')
}

async function loadFee(admin: SupabaseClient, feeId: string): Promise<FeeRow | null> {
  const { data } = await admin.from('cancellation_fees').select(FEE_COLUMNS).eq('id', feeId).maybeSingle()
  return data ? asFee(data as unknown as Record<string, unknown>) : null
}

/**
 * The fee's Stripe invoice, finalized: created on first call, picked up again
 * on any call after. The invoice id is written to the fee as soon as it exists,
 * and both creates are idempotency-keyed on the fee, so a retry can't issue a
 * second invoice for one cancellation.
 */
async function issueInvoice(stripe: Stripe, admin: SupabaseClient, fee: FeeRow): Promise<Stripe.Invoice> {
  const metadata = { [FEE_METADATA_KEY]: fee.id, member_id: fee.member_id }
  const customer = await ensureCustomer(stripe, admin, fee.member_id)

  const addLine = (invoiceId: string) =>
    stripe.invoiceItems.create(
      {
        customer,
        invoice: invoiceId,
        amount: toCents(fee.amount),
        currency: 'usd',
        description: feeInvoiceLine(fee),
        metadata,
      },
      { idempotencyKey: `linkup-fee-invoice-item-${fee.id}` },
    )

  let invoice: Stripe.Invoice
  if (fee.stripe_invoice_id) {
    invoice = await stripe.invoices.retrieve(fee.stripe_invoice_id)
    // A draft left empty by a request that died between the two creates.
    if (invoice.status === 'draft' && invoice.total === 0) {
      await addLine(invoice.id as string)
    }
  } else {
    invoice = await stripe.invoices.create(
      {
        customer,
        collection_method: 'send_invoice',
        days_until_due: INVOICE_DAYS_UNTIL_DUE,
        currency: 'usd',
        // We finalize it ourselves, and our email is the one that goes out.
        auto_advance: false,
        pending_invoice_items_behavior: 'exclude',
        description: 'Late cancellation fee under the LinkUp Golf cancellation policy.',
        metadata,
      },
      { idempotencyKey: `linkup-fee-invoice-${fee.id}` },
    )
    await admin.from('cancellation_fees').update({ stripe_invoice_id: invoice.id }).eq('id', fee.id)
    await addLine(invoice.id as string)
  }

  if (invoice.status === 'draft') {
    invoice = await stripe.invoices.finalizeInvoice(invoice.id as string, { auto_advance: false })
  }
  return invoice
}

/** Writes what Stripe issued onto the fee; returns the invoice page. */
async function storeInvoice(admin: SupabaseClient, fee: FeeRow, invoice: Stripe.Invoice): Promise<string | null> {
  const url = invoice.hosted_invoice_url ?? null
  await admin
    .from('cancellation_fees')
    .update({
      stripe_invoice_id: invoice.id,
      invoice_url: url,
      invoice_pdf: invoice.invoice_pdf ?? null,
      invoice_number: invoice.number ?? null,
      invoiced_at: new Date().toISOString(),
      failure_reason: null,
      // Owed from here. A fee already paid or waived (a late webhook racing a
      // retry) keeps its status.
      ...(fee.status === 'pending' ? { status: 'unpaid' } : {}),
    })
    .eq('id', fee.id)
  return url
}

/**
 * Issues a recorded fee as an invoice and tells the member. Never throws.
 */
export async function invoiceCancellationFee(
  admin: SupabaseClient,
  recorded: CancellationFee,
): Promise<CancellationFeeOutcome> {
  const fee = (await loadFee(admin, recorded.id)) ?? { ...recorded, stripe_invoice_id: null }
  let invoiceUrl: string | null = null

  const stripe = getStripe()
  try {
    // Recorded only while Stripe is on; the guard is for a key removed in between.
    if (!stripe) throw new Error('stripe_unavailable')
    invoiceUrl = await storeInvoice(admin, fee, await issueInvoice(stripe, admin, fee))
  } catch (err) {
    const message = (err as Error).message
    logger.warn('Cancellation fee invoice not issued', {
      action: 'cancellation_fee.invoice_failed',
      metadata: { fee_id: fee.id, error: message },
    })
    // Still owed. The member's "Pay invoice" button issues it later.
    await admin
      .from('cancellation_fees')
      .update({ status: 'unpaid', failure_reason: message === 'stripe_unavailable' ? message : 'invoice_failed' })
      .eq('id', fee.id)
      .eq('status', 'pending')
  }

  void notifyMember(
    fee.member_id,
    NotificationTemplates.cancellationFeeInvoice(
      formatRoundPrice(fee.amount),
      roundName(fee),
      invoiceDate(fee.event_date),
      invoiceUrl,
    ),
  ).catch(() => {})

  return { id: fee.id, amount: fee.amount, percent: fee.percent, status: 'unpaid', invoiceUrl }
}

/**
 * Where a member pays one of their fees: its invoice page, issued now if it
 * never was. Null when there's nothing to pay — not this member's fee, already
 * paid or waived, or Stripe is off.
 */
export async function feeInvoiceUrl(
  admin: SupabaseClient,
  memberId: string,
  feeId: string,
): Promise<string | null> {
  const fee = await loadFee(admin, feeId)
  if (!fee || fee.member_id !== memberId) return null
  if (fee.status !== 'unpaid' && fee.status !== 'pending') return null
  if (fee.invoice_url) return fee.invoice_url

  const stripe = getStripe()
  if (!stripe) return null
  return storeInvoice(admin, fee, await issueInvoice(stripe, admin, fee))
}

/**
 * The webhook's answer to "this fee's money arrived". Idempotent — Stripe
 * delivers at least once — and the member's receipt goes out only on the
 * delivery that actually moved the fee.
 */
export async function settleFeePaid(
  admin: SupabaseClient,
  feeId: string,
  paymentIntentId: string | null = null,
): Promise<boolean> {
  const { data } = await admin
    .from('cancellation_fees')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      failure_reason: null,
      ...(paymentIntentId ? { stripe_payment_intent_id: paymentIntentId } : {}),
    })
    .eq('id', feeId)
    .in('status', ['pending', 'unpaid'])
    .select(FEE_COLUMNS)

  const settled = data?.[0] ? asFee(data[0] as unknown as Record<string, unknown>) : null
  if (!settled) return false

  void notifyMember(
    settled.member_id,
    NotificationTemplates.cancellationFeePaid(
      formatRoundPrice(settled.amount),
      roundName(settled),
      invoiceDate(settled.event_date),
    ),
  ).catch(() => {})
  return true
}

/** The webhook's answer to an invoice voided in the Stripe dashboard. */
export async function settleFeeWaived(admin: SupabaseClient, feeId: string): Promise<void> {
  await admin
    .from('cancellation_fees')
    .update({ status: 'waived' })
    .eq('id', feeId)
    .in('status', ['pending', 'unpaid'])
}

/** A member's fees, newest first, for /more/payments. */
export async function loadMemberFees(admin: SupabaseClient, memberId: string): Promise<CancellationFee[]> {
  const { data } = await admin
    .from('cancellation_fees')
    .select(FEE_COLUMNS)
    .eq('member_id', memberId)
    .order('created_at', { ascending: false })
    .limit(50)
  return (data ?? []).map(r => forMember(asFee(r as unknown as Record<string, unknown>)))
}
