// Which Stripe keys this deployment has. Server-side: both are plain env vars,
// neither carries the NEXT_PUBLIC_ prefix, so neither is compiled into the
// browser bundle.
//
// Kept apart from ./client so the (app) layout can read the publishable key
// without loading the Stripe SDK on every page render.

/**
 * The publishable key Stripe.js needs, or null. Stripe.js runs in the browser,
 * so the key still reaches it: the (app) layout hands it down through
 * StripeKeyProvider, which only signed-in members are served.
 */
export function stripePublishableKey(): string | null {
  return process.env.STRIPE_PUBLISHABLE_KEY || null
}

/**
 * No keys, no policy. Both are required because the policy needs both halves —
 * a secret key with no publishable one would charge cards nobody could have
 * entered.
 */
export function stripeEnabled(): boolean {
  return !!process.env.STRIPE_SECRET_KEY && !!stripePublishableKey()
}
