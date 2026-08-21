// What a booking row costs.
//
// Its own module, and deliberately dependency-free beyond constants: this is
// read by client components (the payment banner, the bookings card), by the
// pending-payment loader, and by the credit-coupon route. Sitting next to the
// loader would drag its server-side neighbours toward the browser bundle for the
// sake of one arithmetic rule.

import { BOOKING_PRICE_USD } from '@/lib/constants'

/**
 * amount_charged is written at booking time and is the answer whenever it's
 * set; the course's own rate and the house default cover rows created before it
 * was populated.
 *
 * Shared with the credit-coupon route so the figure a member is shown and the
 * figure their credit code is sized to can't disagree.
 */
export function bookingAmountDue(row: {
  amount_charged?: number | string | null
  cost_per_player?: number | string | null
}): number {
  const charged = Number(row.amount_charged)
  if (Number.isFinite(charged) && charged > 0) return charged
  const rate = Number(row.cost_per_player)
  return Number.isFinite(rate) && rate > 0 ? rate : BOOKING_PRICE_USD
}
