// ============================================================
// LinkUp Golf — GoHighLevel coupons
// The payments/coupon endpoints, used to turn member credit into a discount the
// member can apply at a venue's checkout. Server-side only.
//
// Not in the SDK, so these go through ghlFetch — with one wrinkle: the payments
// endpoints are versioned 'v3' rather than the 2021-07-28 the rest of the API
// uses, so every call here overrides the Version header.
//
// Docs: https://marketplace.gohighlevel.com/docs/ghl/payments/coupons
//
// Two operational assumptions this file can't enforce, worth knowing:
//   * The checkout behind courses.payment_url must have its coupon field
//     enabled, or a member has nowhere to type the code.
//   * Coupons are created unscoped (no productIds/priceIds) because LinkUp
//     doesn't store GHL product ids per course. A code is therefore valid at any
//     LinkUp checkout — which is fine, since it's worth a fixed amount, is
//     limited to a single use, and is only ever handed to the one member who
//     paid for it out of their own wallet.
// ============================================================

import { ghlFetch } from './client'
import { GHL_PAYMENTS_API_VERSION } from '@/lib/constants'
import { GHLError, ErrorCode } from '@/lib/errors/app-error'

const LOCATION_ID = process.env.GHL_LOCATION_ID ?? ''

/** GHL's own lifecycle for a coupon, independent of how LinkUp records it. */
export type GhlCouponStatus = 'scheduled' | 'active' | 'expired'

export interface GhlCoupon {
  _id: string
  name: string
  code: string
  discountType: 'percentage' | 'amount'
  discountValue: number
  status: GhlCouponStatus
  /** How many times it has been used. Present on fetch/list. */
  usageCount?: number
  startDate?: string
  endDate?: string
  altId?: string
  altType?: string
}

/** The version header every payments call needs. */
const v3 = { Version: GHL_PAYMENTS_API_VERSION }

function requireLocation(): string {
  if (!LOCATION_ID) {
    throw new GHLError('GHL_LOCATION_ID is not set', ErrorCode.GHL_UNAVAILABLE)
  }
  return LOCATION_ID
}

// GHL's own rule on codes, enforced here so a bad code is a clear error at the
// call site instead of a 422 from the provider: "Coupon code can only contain
// letters and numbers".
const CODE_PATTERN = /^[A-Za-z0-9]+$/

/**
 * Create a single-use, fixed-amount coupon.
 *
 * applyToFuturePayments is false and limitPerCustomer true on purpose: this is
 * one discount on one checkout, not a standing arrangement on a subscription.
 * (GHL stores limitPerCustomer as a count and echoes the boolean back as 1.)
 */
export async function createGhlCoupon(params: {
  name: string
  code: string
  /** Dollars off. Always an amount — a percentage can't represent credit. */
  amount: number
  startDate: Date
  /**
   * When the coupon stops working. Omitted for credit codes, which don't
   * expire — GHL accepts a create with no endDate and reports the coupon
   * 'active'.
   */
  endDate?: Date | null
}): Promise<GhlCoupon> {
  if (!CODE_PATTERN.test(params.code)) {
    throw new GHLError(
      `Coupon code must be letters and numbers only, got "${params.code}"`,
      ErrorCode.GHL_UNAVAILABLE,
      { code: params.code }
    )
  }

  return ghlFetch<GhlCoupon>('/payments/coupon', {
    method: 'POST',
    headers: v3,
    body: JSON.stringify({
      altId: requireLocation(),
      altType: 'location',
      name: params.name,
      code: params.code,
      discountType: 'amount',
      discountValue: params.amount,
      startDate: params.startDate.toISOString(),
      // Left out of the payload entirely rather than sent as null — an absent
      // field is what "no end date" means to this API.
      ...(params.endDate ? { endDate: params.endDate.toISOString() } : {}),
      usageLimit: 1,
      limitPerCustomer: true,
      applyToFuturePayments: false,
    }),
  })
}

/**
 * Whether a failed create was GHL refusing the code as taken.
 *
 * Worth telling apart from any other failure: our own unique index can only see
 * codes LinkUp issued, so a code minted by hand in GHL — a marketing promo, or a
 * coupon left behind by an interrupted run — is a clash we can only learn about
 * from the provider, and the fix is simply another code.
 */
export function isDuplicateCouponCodeError(err: unknown): boolean {
  if (!(err instanceof GHLError)) return false
  const body = err.context?.['body'] as { message?: unknown } | undefined
  const message = Array.isArray(body?.message) ? body?.message.join(' ') : String(body?.message ?? '')
  return /already in use/i.test(message)
}

/**
 * Fetch one coupon by GHL id (or by code, when the id was never recorded).
 * Returns null when GHL doesn't have it — a deleted coupon is a normal answer
 * here, not a failure.
 */
export async function getGhlCoupon(params: { id?: string | null; code?: string | null }): Promise<GhlCoupon | null> {
  const query = new URLSearchParams({ altId: requireLocation(), altType: 'location' })
  if (params.id) query.set('id', params.id)
  if (params.code) query.set('code', params.code)
  if (!params.id && !params.code) return null

  try {
    const res = await ghlFetch<GhlCoupon | null>(`/payments/coupon?${query}`, { headers: v3 })
    return res?._id ? res : null
  } catch (err) {
    if (err instanceof GHLError && err.code === ErrorCode.GHL_CONTACT_NOT_FOUND) return null
    throw err
  }
}

/**
 * List the location's coupons, newest page first. `search` matches name or code,
 * so passing the LinkUp prefix keeps marketing promos out of the results.
 */
export async function listGhlCoupons(params: {
  search?: string
  status?: GhlCouponStatus
  limit?: number
  offset?: number
} = {}): Promise<GhlCoupon[]> {
  const query = new URLSearchParams({ altId: requireLocation(), altType: 'location' })
  if (params.search) query.set('search', params.search)
  if (params.status) query.set('status', params.status)
  query.set('limit', String(params.limit ?? 100))
  query.set('offset', String(params.offset ?? 0))

  const res = await ghlFetch<{ data?: GhlCoupon[] }>(`/payments/coupon/list?${query}`, { headers: v3 })
  return res?.data ?? []
}

/**
 * What became of a delete.
 *
 *   'deleted' — gone because we removed it.
 *   'missing' — already gone; GHL answers a delete of an absent coupon with a
 *               404, and for a caller whose goal is "this code must not work"
 *               that is success, not failure.
 *   'failed'  — we could not act on it: the code may well still be live.
 *
 * The distinction is the point of the type. Collapsing 'missing' into a failure
 * blocks a refund on a coupon that demonstrably cannot be redeemed any more.
 */
export type CouponDeleteOutcome = 'deleted' | 'missing' | 'failed'

/**
 * Delete a coupon so a cancelled code can't be used after the credit behind it
 * has been refunded. Never throws — the caller decides what each outcome means
 * for the money.
 */
export async function deleteGhlCoupon(id: string): Promise<CouponDeleteOutcome> {
  try {
    await ghlFetch<{ success?: boolean }>('/payments/coupon', {
      method: 'DELETE',
      headers: v3,
      body: JSON.stringify({ altId: requireLocation(), altType: 'location', id }),
    })
    return 'deleted'
  } catch (err) {
    // ghlFetch maps any 404 to this code.
    if (err instanceof GHLError && err.code === ErrorCode.GHL_CONTACT_NOT_FOUND) return 'missing'
    return 'failed'
  }
}
