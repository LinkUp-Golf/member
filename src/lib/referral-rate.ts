// ============================================================
// LinkUp Golf — Referral rate & payout-period helpers
// Pure, isomorphic maths shared by the server-side modules
// (referral-partners.ts, referral-payouts.ts) and the admin/partner client
// pages. Kept separate so client bundles don't pull in the server-only code.
//
// A partner's percentage is negotiated for a term ending on `ends_at`, and
// commission is settled per calendar month. Dates are compared and sliced as
// YYYY-MM-DD strings so a result never shifts with the server's or the
// browser's timezone.
// ============================================================

import { MEMBERSHIP_FEE_USD } from '@/lib/constants'

/**
 * Commission earned on a single conversion at the given rate, rounded to whole
 * cents so downstream sums don't accumulate binary-float drift (e.g. many lines
 * at 33.33%). Money is stored as numeric(10,2), so a cent is the resolution.
 */
export function commissionForRate(percentage: number): number {
  return Math.round(MEMBERSHIP_FEE_USD * Number(percentage)) / 100
}

/** Sum money values and snap the total to whole cents. */
export function sumCents(values: number[]): number {
  return Math.round(values.reduce((sum, v) => sum + v * 100, 0)) / 100
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

// ---- Payout periods -----------------------------------------

/** The first day of the month a date falls in, as YYYY-MM-DD. */
export function monthOf(date: string): string {
  return `${date.slice(0, 7)}-01`
}

/** Human label for a payout period, e.g. "July 2026". */
export function formatPeriod(periodMonth: string): string {
  return new Date(`${periodMonth.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })
}
