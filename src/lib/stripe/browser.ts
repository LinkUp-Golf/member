// Stripe.js, loaded once per page and only when a card form is actually shown.
//
// The browser half of ./client. It takes the publishable key as an argument
// (from useStripePublishableKey()) rather than reading an env var, so the key
// isn't compiled into the bundle. Nothing secret here; safe in any client component.

import { loadStripe, type Stripe } from '@stripe/stripe-js'

// One promise per page, whatever the key: <Elements> refuses a `stripe` prop
// that changes after mount.
const NO_STRIPE: Promise<Stripe | null> = Promise.resolve(null)
let stripePromise: Promise<Stripe | null> | null = null

export function getBrowserStripe(publishableKey: string | null): Promise<Stripe | null> {
  if (!publishableKey) return NO_STRIPE
  if (!stripePromise) stripePromise = loadStripe(publishableKey)
  return stripePromise
}
