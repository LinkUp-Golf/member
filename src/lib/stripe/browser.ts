// Stripe.js, loaded once per page and only when a card form is actually shown.
//
// The browser half of ./client: it carries the publishable key and nothing
// else, so it's safe in any client component.

import { loadStripe, type Stripe } from '@stripe/stripe-js'

/**
 * Whether this build carries a publishable key — known on first paint, before
 * GET /api/payments/card answers. That answer is still the authority (it also
 * knows whether the secret key is set); this only lets fixed text like the
 * policy appear without waiting on it.
 */
export const browserStripeConfigured = Boolean(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)

let stripePromise: Promise<Stripe | null> | null = null

export function getBrowserStripe(): Promise<Stripe | null> {
  if (!stripePromise) {
    const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
    stripePromise = key ? loadStripe(key) : Promise.resolve(null)
  }
  return stripePromise
}
