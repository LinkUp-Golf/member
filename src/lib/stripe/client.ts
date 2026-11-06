// Stripe — how the cancellation policy collects.
//
// Server-only: the secret key never leaves it. The browser side is
// ./browser (Stripe.js, given the publishable key by the (app) layout) and
// touches nothing here.
//
// No keys, no policy. With STRIPE_SECRET_KEY or STRIPE_PUBLISHABLE_KEY unset,
// stripeEnabled() (./config) is false, and everything that reads it stands down
// together: booking asks for no card, cancelling costs nothing, and nothing fails.

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

/** Where Stripe sends a member back to. Absolute, since it leaves the app. */
export function appUrl(path: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.linkup.golf').replace(/\/+$/, '')
  return `${base}${path}`
}
