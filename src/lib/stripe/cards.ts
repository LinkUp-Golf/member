// Saving and reading the card a late cancellation is charged to.
//
// A member enters their card once, through Stripe's Payment Element (see
// src/components/payments/CardOnFile.tsx), against a SetupIntent created here
// for off-session use — so it can later be charged with nobody at the screen,
// which is exactly when a late-cancellation fee is charged. Nothing is charged
// when the card is saved.
//
// Every function takes the service-role client: member_payment_methods has no
// write policy, and the routes calling these have already decided who's asking.

import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'
import { getStripe, stripeEnabled } from './client'
import { cardFromRow, type SavedCard } from './card'
import { seatUnderPolicy } from '@/lib/cancellation/policy'
import { logger } from '@/lib/logger'

const PAYMENT_METHOD_COLUMNS =
  'member_id, stripe_customer_id, stripe_payment_method_id, card_brand, card_last4, card_exp_month, card_exp_year'

export interface PaymentMethodRow {
  member_id: string
  stripe_customer_id: string
  stripe_payment_method_id: string | null
  card_brand: string | null
  card_last4: string | null
  card_exp_month: number | null
  card_exp_year: number | null
}

export async function loadPaymentMethod(
  admin: SupabaseClient,
  memberId: string,
): Promise<PaymentMethodRow | null> {
  const { data } = await admin
    .from('member_payment_methods')
    .select(PAYMENT_METHOD_COLUMNS)
    .eq('member_id', memberId)
    .maybeSingle()
  return (data as PaymentMethodRow | null) ?? null
}

export async function loadCard(admin: SupabaseClient, memberId: string): Promise<SavedCard | null> {
  return cardFromRow(await loadPaymentMethod(admin, memberId))
}

/**
 * Whether this member has to save a card before they can hold a seat.
 *
 * False whenever Stripe isn't configured: the policy is off, so there is
 * nothing to hold a card for.
 */
export async function needsCardOnFile(admin: SupabaseClient, memberId: string): Promise<boolean> {
  if (!stripeEnabled()) return false
  const row = await loadPaymentMethod(admin, memberId)
  return !row?.stripe_payment_method_id
}

/**
 * The member's Stripe customer, created the first time it's needed.
 *
 * Idempotency-keyed on the member, so two tabs racing through their first card
 * setup get the same customer back from Stripe rather than two of them.
 */
export async function ensureCustomer(
  stripe: Stripe,
  admin: SupabaseClient,
  memberId: string,
): Promise<string> {
  const existing = await loadPaymentMethod(admin, memberId)
  if (existing) return existing.stripe_customer_id

  const { data: member } = await admin
    .from('members')
    .select('email, first_name, last_name')
    .eq('id', memberId)
    .maybeSingle()

  const name = `${member?.first_name ?? ''} ${member?.last_name ?? ''}`.trim()
  const customer = await stripe.customers.create(
    {
      email: member?.email ?? undefined,
      name: name || undefined,
      metadata: { member_id: memberId },
    },
    { idempotencyKey: `linkup-member-customer-${memberId}` },
  )

  // ignoreDuplicates: the racing tab may have written the same row first, and
  // the idempotency key means it's the same customer either way.
  await admin
    .from('member_payment_methods')
    .upsert({ member_id: memberId, stripe_customer_id: customer.id }, { onConflict: 'member_id', ignoreDuplicates: true })

  return customer.id
}

/** A SetupIntent for the Payment Element to confirm, or null when Stripe is off. */
export async function createCardSetup(
  admin: SupabaseClient,
  memberId: string,
): Promise<{ clientSecret: string } | null> {
  const stripe = getStripe()
  if (!stripe) return null

  const customer = await ensureCustomer(stripe, admin, memberId)
  const intent = await stripe.setupIntents.create({
    customer,
    usage: 'off_session',
    allowed_payment_method_types: ['card'],
    metadata: { member_id: memberId },
  })
  if (!intent.client_secret) throw new Error('Stripe returned a SetupIntent with no client secret')
  return { clientSecret: intent.client_secret }
}

/**
 * Makes the card a succeeded SetupIntent collected the member's card on file.
 *
 * Called by the client once the Payment Element confirms, and by the webhook as
 * the backstop for a confirmation that left the page (a bank's 3-D Secure
 * redirect). Both may run for one intent; the second write is the same write.
 * The webhook passes `onlyIfEmpty`: its event can arrive after the member has
 * already replaced the card it describes, and adopting it then would swap their
 * new card for the old one.
 *
 * `memberId` is who the caller says it's for. The intent's own customer has to
 * be that member's, so a member can't adopt a card set up on somebody else's
 * account by posting its id.
 */
export async function saveCardFromSetupIntent(
  admin: SupabaseClient,
  memberId: string,
  setupIntentId: string,
  opts: { onlyIfEmpty?: boolean } = {},
): Promise<SavedCard | null> {
  const stripe = getStripe()
  if (!stripe) return null

  const row = await loadPaymentMethod(admin, memberId)
  if (!row) return null
  if (opts.onlyIfEmpty && row.stripe_payment_method_id) return cardFromRow(row)

  const intent = await stripe.setupIntents.retrieve(setupIntentId, { expand: ['payment_method'] })
  const intentCustomer = typeof intent.customer === 'string' ? intent.customer : intent.customer?.id
  if (intent.status !== 'succeeded' || intentCustomer !== row.stripe_customer_id) return null

  const pm = intent.payment_method as Stripe.PaymentMethod | null
  if (!pm || typeof pm === 'string' || !pm.card) return null
  // Still on the customer. A removed card is detached, and without this the
  // webhook's late event for it would find the row empty and put it back.
  const pmCustomer = typeof pm.customer === 'string' ? pm.customer : pm.customer?.id
  if (pmCustomer !== row.stripe_customer_id) return null

  const previous = row.stripe_payment_method_id
  const { error } = await admin
    .from('member_payment_methods')
    .update({
      stripe_payment_method_id: pm.id,
      card_brand: pm.card.brand,
      card_last4: pm.card.last4,
      card_exp_month: pm.card.exp_month,
      card_exp_year: pm.card.exp_year,
    })
    .eq('member_id', memberId)
  if (error) throw new Error(error.message)

  // The default too, so the card is the same one wherever Stripe is asked.
  await stripe.customers
    .update(row.stripe_customer_id, { invoice_settings: { default_payment_method: pm.id } })
    .catch(err => logger.warn('Could not set default payment method', {
      action: 'stripe.default_pm_failed',
      metadata: { member_id: memberId, error: (err as Error).message },
    }))

  // A replaced card is detached rather than left on the customer, so "the card
  // on file" means one card, here and in the Stripe dashboard alike.
  if (previous && previous !== pm.id) {
    await stripe.paymentMethods.detach(previous).catch(() => {})
  }

  return cardFromRow({
    stripe_payment_method_id: pm.id,
    card_brand: pm.card.brand,
    card_last4: pm.card.last4,
    card_exp_month: pm.card.exp_month,
    card_exp_year: pm.card.exp_year,
  })
}

/**
 * How many upcoming rounds this member's card is guaranteeing: rounds where a
 * late cancel could still be charged to them. Those are the seats on their own
 * bookings and the ones they've been added to that the policy covers
 * (seatUnderPolicy), and host-round spots reserved under it. Counted per round,
 * not per seat, since that's what the member would recognise.
 *
 * "Upcoming" starts a day before today in UTC. Every venue's own today falls
 * on or after that, and a round played yesterday holding the card a few hours
 * longer costs nobody anything.
 *
 * Throws on an unreadable table: the answer decides whether a card can be
 * removed, and a guess of "none" would let it go.
 */
export async function roundsHeldByCard(admin: SupabaseClient, memberId: string): Promise<number> {
  const since = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)

  const [bookings, registrations] = await Promise.all([
    admin
      .from('bookings')
      .select('course_id, booking_date, tee_time, status, invite_status, cancellation_policy_applies')
      .or(`member_id.eq.${memberId},player_member_id.eq.${memberId}`)
      .gte('booking_date', since),
    admin
      .from('hosted_event_registrations')
      .select('hosted_event_id, event:hosted_events!inner(event_date, status)')
      .eq('member_id', memberId)
      .eq('status', 'reserved')
      .eq('cancellation_policy_applies', true)
      .eq('event.status', 'upcoming')
      .gte('event.event_date', since),
  ])
  if (bookings.error) throw new Error(bookings.error.message)
  if (registrations.error) throw new Error(registrations.error.message)

  const rounds = new Set<string>()
  for (const seat of bookings.data ?? []) {
    if (seatUnderPolicy(seat)) rounds.add(`${seat.course_id}|${seat.booking_date}|${seat.tee_time}`)
  }
  for (const reg of registrations.data ?? []) rounds.add(`event|${reg.hosted_event_id}`)
  return rounds.size
}

/**
 * Takes the card off the member: the row keeps the Stripe customer (the next
 * card goes on the same one) and loses the card, and the card is detached in
 * Stripe so it can't be charged from anywhere. The caller has already checked
 * roundsHeldByCard.
 *
 * The update is conditional on the card it read, so a card saved in another
 * tab a moment ago isn't the one wiped.
 */
export async function removeCard(admin: SupabaseClient, memberId: string): Promise<void> {
  const row = await loadPaymentMethod(admin, memberId)
  const pmId = row?.stripe_payment_method_id
  if (!pmId) return

  const { error } = await admin
    .from('member_payment_methods')
    .update({
      stripe_payment_method_id: null,
      card_brand: null,
      card_last4: null,
      card_exp_month: null,
      card_exp_year: null,
    })
    .eq('member_id', memberId)
    .eq('stripe_payment_method_id', pmId)
  if (error) throw new Error(error.message)

  // After the row, not before: a detach that fails leaves a card on the
  // customer that nothing here will charge, where the other order would leave
  // the app pointing at a card Stripe no longer has.
  await getStripe()?.paymentMethods.detach(pmId).catch(err => logger.warn('Could not detach a removed card', {
    action: 'stripe.detach_failed',
    metadata: { member_id: memberId, error: (err as Error).message },
  }))
}
