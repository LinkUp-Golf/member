// ============================================================
// LinkUp Golf — Referral commission rate helpers
// Pure, isomorphic date/rate maths shared by the server-side analytics module
// (src/lib/referral-partners.ts) and the admin/partner client pages. Kept
// separate so client bundles don't pull in the server-only analytics code.
//
// A partner's percentage is negotiated for a term ending on `ends_at`. Dates
// are compared as YYYY-MM-DD strings so a result never shifts with the
// server's or the browser's timezone.
// ============================================================

import { MEMBERSHIP_FEE_USD } from '@/lib/constants'

/** Commission earned on a single conversion at the given rate. */
export function commissionForRate(percentage: number): number {
  return MEMBERSHIP_FEE_USD * (Number(percentage) / 100)
}

/** True when `date` falls on or before the partner's rate expiry. */
export function isWithinRateWindow(date: string, endsAt?: string | null): boolean {
  if (!endsAt) return true
  return date.slice(0, 10) <= endsAt.slice(0, 10)
}

/**
 * True when the rate term has already lapsed — new conversions earn nothing.
 * Commission already accrued on earlier conversions is unaffected.
 */
export function isRateExpired(endsAt: string | null | undefined, today = new Date()): boolean {
  if (!endsAt) return false
  return endsAt.slice(0, 10) < today.toISOString().slice(0, 10)
}
