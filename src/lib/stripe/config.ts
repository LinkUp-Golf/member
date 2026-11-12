// Whether Stripe is set up for this deployment. Server-side only.
//
// Kept apart from ./client so a layout can ask without loading the Stripe SDK
// on every page render.

/**
 * No key, no policy. Late-cancellation fees are invoiced, so the secret key is
 * all the app needs: nothing runs Stripe in the browser any more, and Stripe's
 * own invoice page is where a member pays.
 */
export function stripeEnabled(): boolean {
  return !!process.env.STRIPE_SECRET_KEY
}
