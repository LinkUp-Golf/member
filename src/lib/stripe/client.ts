// Stripe — how the cancellation policy collects.
//
// Server-only: the secret key never leaves it. The browser side is
// ./browser (Stripe.js, with the publishable key) and touches nothing here.
//
// No keys, no policy. With STRIPE_SECRET_KEY or the publishable key unset,
// stripeEnabled() is false, and everything that reads it stands down together:
// booking asks for no card, cancelling costs nothing, and nothing fails. Both
// keys are required because the policy needs both halves — a secret key with no
// publishable one would charge cards nobody could have entered.

import Stripe from 'stripe'

let client: Stripe | null = null

export function stripeEnabled(): boolean {
  return !!process.env.STRIPE_SECRET_KEY && !!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
}

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
