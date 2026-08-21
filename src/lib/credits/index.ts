// ============================================================
// LinkUp Golf — Member credit wallet
// One wallet per member, whatever earned the credit (hosting an event, a
// referral payout, an admin adjustment). The ledger is append-only with signed
// amounts (earned +, redeemed -, adjusted ±), so a balance is simply the sum.
// These helpers derive the earned / redeemed / balance triad and load history.
//
// Earning is open to anyone with a host or partner role; spending it requires an
// active membership (canRedeemCredit below, enforced for real inside the redeem
// RPC). A non-member's balance accrues until they join.
//
// Credit is spent as a GoHighLevel coupon: a code worth a fixed number of
// dollars that the member enters at the venue's checkout. The sizing, code
// generation and lifecycle rules for those coupons are the pure helpers at the
// bottom of this file; the GHL calls and the wallet debit live in ./coupons.
//
// Nothing in this file imports server-only code: summarizeCredits is pure and
// the loaders take a client as a parameter, so a client component can import a
// sibling of theirs without dragging next/headers into its bundle. Redemption,
// which does send notifications, lives in ./redeem for that reason.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { CreditEntry, CreditSummary, CreditCoupon } from '@/types'
import {
  CREDIT_COUPON_CODE_ALPHABET,
  CREDIT_COUPON_CODE_LENGTH,
  CREDIT_COUPON_CODE_PREFIX,
} from '@/lib/constants'

type AdminClient = SupabaseClient

/** Round to whole cents, guarding against float drift and negative zero. */
const round2 = (n: number) => {
  const r = Math.round(n * 100) / 100
  return r === 0 ? 0 : r
}

/**
 * Earned / redeemed / balance from ledger rows. Positive movements (earned and
 * any positive adjustment) count toward earned; negative ones (redeemed and any
 * negative adjustment) toward redeemed, reported as a positive magnitude.
 */
export function summarizeCredits(
  entries: { amount: number }[]
): CreditSummary {
  let earned = 0
  let redeemed = 0
  let balance = 0

  for (const e of entries) {
    const amount = Number(e.amount)
    balance += amount
    if (amount >= 0) earned += amount
    else redeemed += amount
  }

  return {
    earned: round2(earned),
    redeemed: round2(-redeemed), // stored negative; present as a positive figure
    balance: round2(balance),
  }
}

/** A member's credit summary (earned / redeemed / balance). */
export async function loadCreditSummary(
  admin: AdminClient,
  memberId: string
): Promise<CreditSummary> {
  const { data } = await admin
    .from('credit_ledger')
    .select('kind, amount')
    .eq('member_id', memberId)

  return summarizeCredits((data ?? []) as { amount: number }[])
}

/**
 * Whether this member may spend their balance — i.e. holds an active
 * membership. Read-only mirror of the rule enforced in redeem_member_credit, so
 * the wallet can explain a disabled button instead of failing the submit. The
 * RPC is the authority; this must never be the only check.
 */
export async function canRedeemCredit(
  admin: AdminClient,
  memberId: string
): Promise<boolean> {
  const { data } = await admin
    .from('members')
    .select('membership_status')
    .eq('id', memberId)
    .maybeSingle()

  return data?.membership_status === 'active'
}

/** A member's full ledger, newest first. */
export async function loadCreditEntries(
  admin: AdminClient,
  memberId: string
): Promise<CreditEntry[]> {
  const { data } = await admin
    .from('credit_ledger')
    .select('*')
    .eq('member_id', memberId)
    .order('created_at', { ascending: false })

  return (data ?? []) as CreditEntry[]
}

// ---- Credit coupons -----------------------------------------
// Pure rules: how much a code is worth, what it's called, and what a GHL state
// means for the row holding it.
//
// Codes don't expire. They used to lapse after 30 days and refund themselves,
// which put a deadline on money the member already owned; now a code lasts until
// it's used or refunded. Rows carrying an expires_at are from before that change
// and are still honoured — see couponSettlementOutcome.

/**
 * How much credit a code should carry, or why it can't be issued.
 *
 * A code issued against a bill is worth exactly that bill — no more, because a
 * fixed-amount coupon throws away anything above the total, and no less, because
 * a code that only part-pays a round is a code that fails at the till. So a
 * balance that doesn't cover the bill isn't sized down to fit, it's refused, and
 * the member keeps their credit until it's worth something here.
 *
 * `price` is null for a plain wallet conversion. There's no bill to cover, so
 * the member names the amount and the balance is the only ceiling.
 */
export type CouponAmount =
  | { ok: true; amount: number }
  | {
      ok: false
      /** 'empty' — nothing to spend. 'short' — not enough for this bill. */
      reason: 'empty' | 'short'
      /** How much more credit the bill needs. Zero when there's no bill. */
      shortfall: number
    }

export function creditCouponAmount(params: {
  balance: number
  /** What is owed, when the code is being issued against a specific bill. */
  price?: number | null
  /** An explicit amount the member asked for. Ignored when there's a bill. */
  requested?: number | null
}): CouponAmount {
  const balance = round2(Math.max(0, Number(params.balance) || 0))
  const price = params.price == null ? null : round2(Math.max(0, Number(params.price) || 0))
  const requested = params.requested == null ? null : round2(Number(params.requested) || 0)

  if (balance <= 0) return { ok: false, reason: 'empty', shortfall: round2(price ?? 0) }

  if (price != null) {
    // Compared after rounding, so a balance that is a whole-cent match for the
    // bill counts as covering it rather than failing on float dust.
    if (balance < price) return { ok: false, reason: 'short', shortfall: round2(price - balance) }
    // Deliberately not `requested`: a bill-linked code is the bill. Letting a
    // client ask for less would reintroduce the part-paying code by the back
    // door.
    return { ok: true, amount: price }
  }

  const amount = round2(Math.min(requested != null && requested > 0 ? requested : balance, balance))
  return amount > 0 ? { ok: true, amount } : { ok: false, reason: 'empty', shortfall: 0 }
}

/**
 * A code the member can read off a screen and type: the LinkUp prefix plus
 * random characters, drawn from an alphabet with no look-alike pairs.
 *
 * Letters and numbers only, with no separator — GHL refuses anything else with
 * a 422 ("Coupon code can only contain letters and numbers"), which is why this
 * reads LUCAB2CD rather than LUC-AB2CD.
 *
 * Uniqueness is the caller's problem, not this function's — the unique index on
 * credit_coupons.code and GHL's own duplicate check are what actually enforce
 * it, and the caller retries on a clash.
 */
export function generateCouponCode(
  randomBytes: (n: number) => Uint8Array = cryptoRandomBytes
): string {
  const bytes = randomBytes(CREDIT_COUPON_CODE_LENGTH)
  let out = ''
  for (let i = 0; i < CREDIT_COUPON_CODE_LENGTH; i++) {
    out += CREDIT_COUPON_CODE_ALPHABET[(bytes[i] ?? 0) % CREDIT_COUPON_CODE_ALPHABET.length]
  }
  return `${CREDIT_COUPON_CODE_PREFIX}${out}`
}

function cryptoRandomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n))
}

/**
 * What a coupon's state in GHL means for the LinkUp row holding it — the input
 * to settle_credit_coupon, or null to leave it open.
 *
 * `expiresAt` is null on every code issued now, and such a code never lapses:
 * the only ways it stops being open are being used or being refunded. A date is
 * a legacy row from when codes expired, and it still counts.
 *
 * The case worth understanding is a code GHL doesn't have:
 *
 *   * If we never recorded a GHL id for it, it never reached the provider —
 *     issuing debited the wallet and then the create call failed. Nothing could
 *     ever have been redeemed with it, so it is void and the credit goes back.
 *     Without this rule that credit would sit debited forever, since a code with
 *     no id can't be looked up in GHL to expire it either.
 *   * If we did have an id, the coupon existed and has since been deleted at the
 *     provider. It's refunded once past its own expiry — deliberately choosing
 *     the small risk of refunding a code that was used and then deleted by hand
 *     over the certainty of stranding a member's credit indefinitely.
 */
export function couponSettlementOutcome(params: {
  ghl: { status?: string; usageCount?: number } | null
  /** Whether LinkUp had recorded a GHL id for this code before the lookup. */
  hadGhlId?: boolean
  /** Null for a code with no end date, which is how they're issued now. */
  expiresAt: string | null
  now?: Date
}): 'redeemed' | 'expired' | 'void' | null {
  const now = params.now ?? new Date()
  const pastExpiry = params.expiresAt != null && Date.parse(params.expiresAt) <= now.getTime()

  if (!params.ghl) {
    if (!params.hadGhlId) return 'void'
    return pastExpiry ? 'expired' : null
  }

  // A used code is spent whatever its dates say — never refundable.
  if ((params.ghl.usageCount ?? 0) > 0) return 'redeemed'

  return params.ghl.status === 'expired' || pastExpiry ? 'expired' : null
}

/**
 * Whether a code can still be used: open, and inside its window if it has one.
 * A code with no expiry (all of them, now) is usable until it's used or
 * refunded.
 */
export function isCouponUsable(coupon: Pick<CreditCoupon, 'status' | 'expires_at'>, now = new Date()): boolean {
  if (coupon.status !== 'issued') return false
  return coupon.expires_at == null || Date.parse(coupon.expires_at) > now.getTime()
}

/** A member's coupons, newest first. */
export async function loadMemberCoupons(
  admin: AdminClient,
  memberId: string
): Promise<CreditCoupon[]> {
  const { data } = await admin
    .from('credit_coupons')
    .select('*, course:courses(id, name, payment_url)')
    .eq('member_id', memberId)
    .order('created_at', { ascending: false })

  return (data ?? []) as CreditCoupon[]
}
