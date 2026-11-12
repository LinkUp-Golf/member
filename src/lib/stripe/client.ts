// Stripe — how the cancellation policy collects: an invoice per late
// cancellation (src/lib/cancellation/fees.ts).
//
// Server-only: the secret key never leaves it.
//
// No key, no policy. With STRIPE_SECRET_KEY unset, stripeEnabled() (./config)
// is false, and everything that reads it stands down together: no screen
// states a fee, cancelling costs nothing, and nothing fails.

import Stripe from 'stripe'
import { stripeEnabled } from './config'

export { stripeEnabled }

let client: Stripe | null = null

/** The shared client, or null when Stripe isn't configured. */
export function getStripe(): Stripe | null {
  if (!stripeEnabled()) return null
  if (!client) {
    client = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
      appInfo: { name: 'LinkUp Golf' },
      maxNetworkRetries: 2,
    })
  }
  return client
}
