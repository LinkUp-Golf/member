// Charging a late cancellation.
//
// Three steps, in an order that matters:
//
//   1. recordCancellationFee — before the seat is released. If the record can't
//      be written the cancel route refuses, and nothing has happened; the other
//      order lets a member off free whenever this write fails. The unique index
//      on the seat makes a double tap on Cancel record one fee, not two.
//   2. the route releases the seat; if that fails, discardCancellationFee takes
//      the record back out, since nothing was cancelled.
//   3. collectCancellationFee — charges the card on file, off-session. Stripe
//      decides there and then for almost every card. When it can't — a decline,
//      a bank that wants its customer to authenticate, no card at all — the fee
//      is left `unpaid` and the member is told, with a way to pay it from
//      /more/payments (feeCheckoutUrl). Stripe still processing is left
//      `pending` for the webhook to settle.
//
// Collection never fails the cancel. The seat is already given up by then, and
// a member must never be left looking at a round they cancelled because a card
// network was slow.
//
// Who pays is whoever cancelled: they're the one who decided, and the one who
// was shown the fee before confirming. An invited player isn't billed for their
// booker dropping them, nor a booker for an invitee walking away.
//
// Service-role throughout: cancellation_fees has no write policy.

import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'
import { format } from 'date-fns'
import { getStripe, appUrl } from '@/lib/stripe/client'
import { ensureCustomer, loadPaymentMethod } from '@/lib/stripe/cards'
import { cardLabel } from '@/lib/stripe/card'
import { formatRoundPrice } from '@/lib/bookings/price'
import { NotificationTemplates } from '@/lib/push'
import { notifyMember } from '@/lib/notify'
import { logger } from '@/lib/logger'
import { toCents, type CancellationQuote } from './policy'
import type { CancellationFee, CancellationFeeOutcome } from '@/types'

const FEE_COLUMNS =
  'id, member_id, source, booking_id, hosted_event_id, hosted_event_registration_id, course_id, course_name, event_date, tee_time, price, percent, amount, status, failure_reason, paid_at, created_at'

/** The metadata key every Stripe object made for a fee carries. */
export const FEE_METADATA_KEY = 'cancellation_fee_id'

const asFee = (row: Record<string, unknown>): CancellationFee => ({
  ...(row as unknown as CancellationFee),
  price: Number(row.price),
  amount: Number(row.amount),
  percent: Number(row.percent),
})

/** "Sat, Nov 8" — how a fee names its round's day. */
const feeDate = (date: string) => format(new Date(`${date}T12:00:00`), 'EEE, MMM d')

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
  return { fee: asFee(data) }
}

/** Takes back a fee whose cancellation didn't go through. */
export async function discardCancellationFee(admin: SupabaseClient, feeId: string): Promise<void> {
  await admin.from('cancellation_fees').delete().eq('id', feeId).eq('status', 'pending')
}

async function markUnpaid(
  admin: SupabaseClient,
  fee: CancellationFee,
  reason: string,
  paymentIntentId?: string | null,
): Promise<CancellationFeeOutcome> {
  await admin
    .from('cancellation_fees')
    .update({
      status: 'unpaid',
      failure_reason: reason,
      ...(paymentIntentId ? { stripe_payment_intent_id: paymentIntentId } : {}),
    })
    .eq('id', fee.id)
    .eq('status', 'pending')

  void notifyMember(
    fee.member_id,
    NotificationTemplates.cancellationFeeDue(
      formatRoundPrice(fee.amount),
      fee.course_name ?? 'your round',
      feeDate(fee.event_date),
    ),
  ).catch(() => {})

  return { id: fee.id, amount: fee.amount, percent: fee.percent, status: 'unpaid', card: null }
}

/**
 * Charges a recorded fee to the member's card on file. Never throws.
 */
export async function collectCancellationFee(
  admin: SupabaseClient,
  fee: CancellationFee,
): Promise<CancellationFeeOutcome> {
  const stripe = getStripe()
  // Recorded only while Stripe is on; the guard is for a key removed in between.
  if (!stripe) return markUnpaid(admin, fee, 'stripe_unavailable')

  const pm = await loadPaymentMethod(admin, fee.member_id)
  if (!pm?.stripe_payment_method_id) return markUnpaid(admin, fee, 'no_card')

  try {
    const intent = await stripe.paymentIntents.create(
      {
        amount: toCents(fee.amount),
        currency: 'usd',
        customer: pm.stripe_customer_id,
        payment_method: pm.stripe_payment_method_id,
        off_session: true,
        confirm: true,
        description: `Cancellation fee: ${fee.course_name ?? 'LinkUp round'} on ${fee.event_date}`,
        metadata: { [FEE_METADATA_KEY]: fee.id, member_id: fee.member_id },
      },
      // Keyed on the fee, so a retried request can't charge the same fee twice.
      { idempotencyKey: `linkup-cancellation-fee-${fee.id}` },
    )

    if (intent.status === 'succeeded') {
      await admin
        .from('cancellation_fees')
        .update({ status: 'paid', paid_at: new Date().toISOString(), stripe_payment_intent_id: intent.id })
        .eq('id', fee.id)

      const card = pm.card_last4 ? { brand: pm.card_brand ?? '', last4: pm.card_last4 } : null
      void notifyMember(
        fee.member_id,
        NotificationTemplates.cancellationFeeCharged(
          formatRoundPrice(fee.amount),
          fee.course_name ?? 'your round',
          feeDate(fee.event_date),
          card ? cardLabel(card) : 'card on file',
        ),
      ).catch(() => {})

      return { id: fee.id, amount: fee.amount, percent: fee.percent, status: 'paid', card }
    }

    if (intent.status === 'processing') {
      await admin.from('cancellation_fees').update({ stripe_payment_intent_id: intent.id }).eq('id', fee.id)
      return { id: fee.id, amount: fee.amount, percent: fee.percent, status: 'pending', card: null }
    }

    return markUnpaid(admin, fee, intent.status, intent.id)
  } catch (err) {
    // A decline or an authentication_required arrives as a thrown card error,
    // carrying the PaymentIntent it failed on.
    const e = err as Stripe.errors.StripeError & { payment_intent?: { id?: string } }
    logger.warn('Cancellation fee charge failed', {
      action: 'cancellation_fee.charge_failed',
      metadata: { fee_id: fee.id, code: e.code, decline_code: e.decline_code, type: e.type },
    })
    return markUnpaid(admin, fee, e.decline_code ?? e.code ?? e.type ?? 'charge_failed', e.payment_intent?.id ?? null)
  }
}

/**
 * A Stripe Checkout page for paying an unpaid fee, or null when it can't be
 * paid (not this member's, not unpaid, or Stripe is off).
 *
 * Made fresh on every request rather than stored: a Checkout Session expires
 * within a day, and the link in a fee-due email has to work next week.
 */
export async function feeCheckoutUrl(
  admin: SupabaseClient,
  memberId: string,
  feeId: string,
): Promise<string | null> {
  const stripe = getStripe()
  if (!stripe) return null

  const { data } = await admin
    .from('cancellation_fees')
    .select(FEE_COLUMNS)
    .eq('id', feeId)
    .eq('member_id', memberId)
    .maybeSingle()
  if (!data) return null
  const fee = asFee(data)
  if (fee.status !== 'unpaid') return null

  const customer = await ensureCustomer(stripe, admin, memberId)
  const metadata = { [FEE_METADATA_KEY]: fee.id, member_id: memberId }
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: toCents(fee.amount),
          product_data: {
            name: 'Cancellation fee',
            description: `${fee.course_name ?? 'LinkUp round'} · ${feeDate(fee.event_date)} · ${fee.percent}% of ${formatRoundPrice(fee.price)}`,
          },
        },
      },
    ],
    metadata,
    payment_intent_data: { metadata },
    success_url: appUrl(`/more/payments?paid=${fee.id}`),
    cancel_url: appUrl('/more/payments'),
  })

  await admin.from('cancellation_fees').update({ stripe_checkout_session_id: session.id }).eq('id', fee.id)
  return session.url
}

/**
 * The webhook's answer to "this fee's money arrived". Idempotent — Stripe
 * delivers at least once, and a fee can be settled by both its PaymentIntent and
 * the Checkout Session that wrapped it.
 */
export async function settleFeePaid(
  admin: SupabaseClient,
  feeId: string,
  paymentIntentId: string | null,
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
    .select('id')
  return (data?.length ?? 0) > 0
}

/**
 * The webhook's answer to a charge Stripe was still processing that then
 * failed. Only a `pending` fee moves — one already `unpaid` was told already.
 */
export async function settleFeeFailed(
  admin: SupabaseClient,
  feeId: string,
  reason: string,
): Promise<void> {
  const { data } = await admin
    .from('cancellation_fees')
    .select(FEE_COLUMNS)
    .eq('id', feeId)
    .eq('status', 'pending')
    .maybeSingle()
  if (data) await markUnpaid(admin, asFee(data), reason)
}

/** A member's fees, newest first, for /more/payments. */
export async function loadMemberFees(admin: SupabaseClient, memberId: string): Promise<CancellationFee[]> {
  const { data } = await admin
    .from('cancellation_fees')
    .select(FEE_COLUMNS)
    .eq('member_id', memberId)
    .order('created_at', { ascending: false })
    .limit(50)
  return (data ?? []).map(asFee)
}
