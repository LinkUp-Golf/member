// The Stripe customer a member's invoices are issued to.
//
// Stored in member_payment_methods, the table the card-on-file era created:
// its own table so a Stripe id never rides along with a member read. Only
// stripe_customer_id is written now; the card columns stay empty.
//
// Service-role: the table has no write policy.

import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'

/**
 * The member's Stripe customer, created the first time it's needed.
 *
 * Idempotency-keyed on the member, so two requests racing through a member's
 * first invoice get the same customer back from Stripe rather than two.
 */
export async function ensureCustomer(
  stripe: Stripe,
  admin: SupabaseClient,
  memberId: string,
): Promise<string> {
  const { data: existing } = await admin
    .from('member_payment_methods')
    .select('stripe_customer_id')
    .eq('member_id', memberId)
    .maybeSingle()
  if (existing?.stripe_customer_id) return existing.stripe_customer_id as string

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

  // ignoreDuplicates: a racing request may have written the same row first,
  // and the idempotency key means it's the same customer either way.
  await admin
    .from('member_payment_methods')
    .upsert({ member_id: memberId, stripe_customer_id: customer.id }, { onConflict: 'member_id', ignoreDuplicates: true })

  return customer.id
}
