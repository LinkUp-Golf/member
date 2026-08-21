// ============================================================
// LinkUp Golf — Credit → GHL coupon
// Server-only: talks to GHL and sends notifications.
//
// Spending credit means getting a code. This module debits the wallet, creates
// the matching fixed-amount coupon in GoHighLevel, and hands back the code the
// member types at the venue's checkout — so paying by credit and paying cash
// end at the same place, with the discount standing in for the cash.
//
// Ordering is deliberate and worth keeping: the wallet is debited first (in one
// transaction with the coupon row, inside issue_credit_coupon), and only then is
// the coupon created in GHL. A failure in that window strands the member's
// credit for as long as it takes to void the row — which the code below does
// immediately, refunding as it goes. The other order would risk a live coupon
// nobody paid for, which is money out the door.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createGhlCoupon,
  deleteGhlCoupon,
  getGhlCoupon,
  isDuplicateCouponCodeError,
} from '@/lib/ghl/coupons'
import { sendPushToMember, NotificationTemplates } from '@/lib/push'
import { sanitiseText } from '@/lib/validation'
import { logger } from '@/lib/logger'
import {
  couponSettlementOutcome,
  creditCouponAmount,
  generateCouponCode,
  loadCreditSummary,
} from './index'
import type { CreditCoupon, CreditSummary } from '@/types'

type AdminClient = SupabaseClient

/**
 * What the code is being issued against.
 *
 * 'booking' and 'hosted_event' carry a price, so the code is sized to the bill
 * and linked to it — which is also what lets an admin see that the round was
 * paid with credit. 'general' is a plain wallet conversion: no bill, so the only
 * ceiling is the balance.
 */
export type CouponTarget =
  | {
      kind: 'booking'
      bookingId: string
      courseId: string | null
      price: number
    }
  | {
      kind: 'hosted_event'
      hostedEventId: string
      courseId: string | null
      price: number
    }
  | { kind: 'general' }

export type IssueCouponResult =
  | {
      ok: true
      coupon: CreditCoupon
      summary: CreditSummary
      /** True when an open code for this bill already existed and was returned. */
      existing: boolean
    }
  | {
      ok: false
      status: number
      error: string
      /** How much more credit the bill needed, when that was the reason. */
      shortfall?: number
    }

export type CancelCouponResult =
  | { ok: true; coupon: CreditCoupon; summary: CreditSummary }
  | { ok: false; status: number; error: string }

const COUPON_SELECT = '*, course:courses(id, name, payment_url)'

/** Dollars, for error copy a member reads. */
const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * How many times a code clash is worth retrying before giving up. A clash can
 * come from either side — our unique index, or GHL refusing a code it already
 * has — and both are answered by generating another one.
 */
const CODE_ATTEMPTS = 4

function targetIds(target: CouponTarget) {
  return {
    bookingId: target.kind === 'booking' ? target.bookingId : null,
    hostedEventId: target.kind === 'hosted_event' ? target.hostedEventId : null,
    courseId: target.kind === 'general' ? null : target.courseId,
    price: target.kind === 'general' ? null : target.price,
  }
}

/** The open coupon already covering this bill, if there is one. */
async function findOpenCoupon(
  admin: AdminClient,
  memberId: string,
  target: CouponTarget
): Promise<CreditCoupon | null> {
  if (target.kind === 'general') return null

  let query = admin
    .from('credit_coupons')
    .select(COUPON_SELECT)
    .eq('member_id', memberId)
    .eq('status', 'issued')

  query = target.kind === 'booking'
    ? query.eq('booking_id', target.bookingId)
    : query.eq('hosted_event_id', target.hostedEventId)

  const { data } = await query.maybeSingle()
  return (data as CreditCoupon | null) ?? null
}

/**
 * Convert credit into a coupon code.
 *
 * Idempotent per bill: a member who taps twice gets the code they already hold
 * back, not a second debit. That's enforced twice over — read first, and by the
 * partial unique indexes if two requests race past the read.
 */
export async function issueCreditCoupon(params: {
  admin: AdminClient
  memberId: string
  target: CouponTarget
  /** An explicit amount; defaults to whatever covers the bill. */
  requested?: unknown
  note?: unknown
  /** For the audit log — which surface the request came from. */
  context?: Record<string, unknown>
}): Promise<IssueCouponResult> {
  const { admin, memberId, target } = params
  const { bookingId, hostedEventId, courseId, price } = targetIds(target)

  const existing = await findOpenCoupon(admin, memberId, target)
  if (existing) {
    return {
      ok: true,
      coupon: existing,
      summary: await loadCreditSummary(admin, memberId),
      existing: true,
    }
  }

  const requested = params.requested == null || params.requested === ''
    ? null
    : Number(params.requested)
  if (requested != null && (!Number.isFinite(requested) || requested <= 0)) {
    return { ok: false, status: 400, error: 'Enter an amount greater than zero.' }
  }

  const summary = await loadCreditSummary(admin, memberId)
  const sized = creditCouponAmount({ balance: summary.balance, price, requested })

  if (!sized.ok) {
    // Nothing is debited on this path — the member keeps the balance they have.
    if (sized.reason === 'short') {
      return {
        ok: false,
        status: 409,
        error: `Your ${money(summary.balance)} in credits doesn't cover this ${money(price ?? 0)} round — you'd need ${money(sized.shortfall)} more. A code has to pay the round in full.`,
        shortfall: sized.shortfall,
      }
    }
    return { ok: false, status: 409, error: 'You don\'t have any credit to use yet.' }
  }

  const amount = sized.amount

  const note = typeof params.note === 'string' && params.note.trim()
    ? sanitiseText(params.note.trim())
    : null

  const now = new Date()

  // ---- Debit the wallet, reserve the code, create it in GHL -----------
  // One attempt is all three, because a code can be refused at either end: by
  // our unique index, or by GHL — which is the only place that knows about codes
  // LinkUp didn't issue. Either way the answer is another code, so a failed
  // attempt refunds and the loop goes round.
  let coupon: CreditCoupon | null = null
  let lastError: { code?: string; message?: string } | null = null
  let ghlError: unknown = null
  let refundFailed = false

  for (let attempt = 0; attempt < CODE_ATTEMPTS && !coupon; attempt++) {
    const code = generateCouponCode()
    const { data, error } = await admin.rpc('issue_credit_coupon', {
      p_member_id: memberId,
      p_amount: amount,
      p_code: code,
      // No end date: a code lasts until it's used or refunded.
      p_expires_at: null,
      p_booking_id: bookingId,
      p_hosted_event_id: hostedEventId,
      p_course_id: courseId,
      p_note: note,
      p_created_by: memberId,
    })

    if (error) {
      lastError = error

      // A generated code that already exists here: try another one.
      if (error.code === '23505' && error.message?.includes('credit_coupons_code_key')) continue

      // Two requests raced for the same bill and the other one won. Its code is
      // the answer to this request too.
      if (error.code === '23505' && error.message?.includes('credit_coupons_open_')) {
        const raced = await findOpenCoupon(admin, memberId, target)
        if (raced) {
          return {
            ok: true,
            coupon: raced,
            summary: await loadCreditSummary(admin, memberId),
            existing: true,
          }
        }
      }

      break
    }

    const reserved = data as CreditCoupon

    try {
      const ghl = await createGhlCoupon({
        // Named so the coupon is identifiable in the GHL dashboard without
        // cross-referencing anything.
        name: `LinkUp credit ${reserved.code}`,
        code: reserved.code,
        amount,
        startDate: now,
      })

      const { data: attached } = await admin.rpc('attach_credit_coupon_ghl_id', {
        p_coupon_id: reserved.id,
        p_ghl_coupon_id: ghl._id,
      })
      coupon = (attached as CreditCoupon | null) ?? reserved
    } catch (err) {
      ghlError = err

      // The credit is already debited, so it has to come back — a void refunds
      // it (see settle_credit_coupon).
      const { error: voidError } = await admin.rpc('settle_credit_coupon', {
        p_coupon_id: reserved.id,
        p_outcome: 'void',
        p_usage_count: 0,
        p_reason: 'Credit code could not be created at the payment provider',
        p_created_by: memberId,
      })
      refundFailed = !!voidError

      logger.error('GHL coupon creation failed', {
        action: 'credit.coupon_ghl_failed',
        userId: memberId,
        // Top-level as well as in metadata: the dev log formatter prints
        // errorMessage but drops metadata, and a failure whose cause isn't in
        // the line is a failure someone has to reproduce to understand.
        errorMessage: err instanceof Error ? err.message : String(err),
        metadata: {
          ...params.context,
          coupon_id: reserved.id,
          code: reserved.code,
          amount,
          refunded: !voidError,
          duplicate_code: isDuplicateCouponCodeError(err),
          void_error: voidError?.message ?? null,
        },
      })

      // GHL already has that code — one it minted itself, or one left behind by
      // an interrupted run. Nothing wrong with the request, so try another code
      // rather than failing the member. Any other failure is real: stop.
      if (isDuplicateCouponCodeError(err) && !voidError) continue
      break
    }
  }

  if (!coupon && ghlError) {
    // If even the refund failed, the row is left open with no GHL id — which is
    // exactly the state syncCreditCoupons voids and refunds. So the credit does
    // come back, just not this second; say that rather than claiming the balance
    // was never touched.
    return {
      ok: false,
      status: 502,
      error: refundFailed
        ? 'We couldn\'t create your credit code just now. The credit will be back in your balance shortly — please try again after that.'
        : 'We couldn\'t create your credit code just now. Your balance is untouched — please try again.',
    }
  }

  if (!coupon) {
    const message = lastError?.message ?? ''
    // The P0001 contract from issue_credit_coupon.
    if (message.startsWith('NOT_A_MEMBER')) {
      return {
        ok: false,
        status: 403,
        error: 'Spending credit needs an active LinkUp membership. Your balance keeps building until then.',
      }
    }
    if (message.startsWith('INSUFFICIENT_BALANCE')) {
      return { ok: false, status: 409, error: 'That exceeds your available balance.' }
    }
    if (message.startsWith('INVALID_AMOUNT')) {
      return { ok: false, status: 400, error: 'Enter an amount greater than zero.' }
    }
    logger.error('Credit coupon issue failed', {
      action: 'credit.coupon_issue_failed',
      userId: memberId,
      metadata: { ...params.context, amount, error: message },
    })
    return { ok: false, status: 500, error: 'Could not create your credit code.' }
  }

  void sendPushToMember(
    memberId,
    NotificationTemplates.creditCouponIssued(amount, coupon.code)
  ).catch(() => {})

  logger.info('Credit coupon issued', {
    action: 'credit.coupon_issued',
    userId: memberId,
    metadata: {
      ...params.context,
      coupon_id: coupon.id,
      amount,
      booking_id: bookingId,
      hosted_event_id: hostedEventId,
    },
  })

  return {
    ok: true,
    coupon,
    summary: await loadCreditSummary(admin, memberId),
    existing: false,
  }
}

/**
 * Cancel an unused code and put the credit back.
 *
 * The order matters, and so does telling three GHL states apart:
 *
 *   * Already used — refund nothing. The credit bought a round; handing it back
 *     would be giving the round away. The row is settled as redeemed instead, so
 *     the wallet stops offering a refund that shouldn't happen.
 *   * Gone from GHL, or deleted here — refund. Nothing can be redeemed with a
 *     code the provider doesn't have, which is exactly the state a cancel is
 *     trying to reach.
 *   * Couldn't be reached — refund nothing yet. The code may still be live, and
 *     paying credit back while it works would let it be spent twice.
 */
export async function cancelCreditCoupon(params: {
  admin: AdminClient
  couponId: string
  /** Set for a member cancelling their own code; omitted for an admin. */
  memberId?: string
  actorId: string
  reason?: string | null
}): Promise<CancelCouponResult> {
  const { admin, couponId, memberId, actorId } = params

  const { data } = await admin
    .from('credit_coupons')
    .select(COUPON_SELECT)
    .eq('id', couponId)
    .maybeSingle()

  const coupon = data as CreditCoupon | null
  if (!coupon) return { ok: false, status: 404, error: 'That credit code no longer exists.' }
  if (memberId && coupon.member_id !== memberId) {
    return { ok: false, status: 404, error: 'That credit code no longer exists.' }
  }
  if (coupon.status !== 'issued') {
    return {
      ok: false,
      status: 409,
      error: coupon.status === 'redeemed'
        ? 'That code has already been used.'
        : 'That code is no longer active.',
    }
  }

  // What GHL thinks of it right now. Looked up by code as well as id, so a
  // coupon whose id never got stored is still found rather than assumed absent.
  let live: Awaited<ReturnType<typeof getGhlCoupon>>
  try {
    live = await getGhlCoupon({ id: coupon.ghl_coupon_id, code: coupon.code })
  } catch (err) {
    logger.error('Credit coupon lookup failed at GHL — refund withheld', {
      action: 'credit.coupon_cancel_failed',
      userId: actorId,
      errorMessage: err instanceof Error ? err.message : String(err),
      metadata: { coupon_id: coupon.id, ghl_coupon_id: coupon.ghl_coupon_id },
    })
    return {
      ok: false,
      status: 502,
      error: 'We couldn\'t check that code with the payment provider just now. Nothing has changed — try again shortly.',
    }
  }

  // Spent. Record that rather than refunding, so the code stops looking
  // refundable and the ledger matches what actually happened.
  if (live && (live.usageCount ?? 0) > 0) {
    await admin.rpc('settle_credit_coupon', {
      p_coupon_id: coupon.id,
      p_outcome: 'redeemed',
      p_usage_count: live.usageCount ?? 1,
      p_reason: null,
      p_created_by: actorId,
    })
    logger.info('Credit coupon already used — marked redeemed instead of refunded', {
      action: 'credit.coupon_cancel_already_used',
      userId: actorId,
      metadata: { coupon_id: coupon.id, usage_count: live.usageCount },
    })
    return {
      ok: false,
      status: 409,
      error: 'That code has already been used at checkout, so there\'s nothing to refund.',
    }
  }

  if (live) {
    const outcome = await deleteGhlCoupon(live._id)
    if (outcome === 'failed') {
      logger.error('Credit coupon delete failed at GHL — refund withheld', {
        action: 'credit.coupon_cancel_failed',
        userId: actorId,
        metadata: { coupon_id: coupon.id, ghl_coupon_id: live._id },
      })
      return {
        ok: false,
        status: 502,
        error: 'We couldn\'t cancel that code just now. It\'s still valid — try again shortly.',
      }
    }
  }
  // Nothing at GHL to delete: already removed there, or it never got created.
  // Either way the code is dead and the credit is owed back.

  const { data: settled, error } = await admin.rpc('settle_credit_coupon', {
    p_coupon_id: coupon.id,
    p_outcome: 'void',
    p_usage_count: 0,
    // Worth saying in the ledger when the coupon had already vanished from the
    // provider: it explains a refund nobody here initiated a delete for.
    p_reason: params.reason
      ? sanitiseText(params.reason)
      : live
        ? null
        : `Credit code ${coupon.code} cancelled — no longer present at the payment provider`,
    p_created_by: actorId,
  })

  if (error) {
    logger.error('Credit coupon void failed after GHL delete', {
      action: 'credit.coupon_cancel_failed',
      userId: actorId,
      metadata: { coupon_id: coupon.id, error: error.message },
    })
    return { ok: false, status: 500, error: 'Could not cancel that code.' }
  }

  logger.info('Credit coupon cancelled', {
    action: 'credit.coupon_cancelled',
    userId: actorId,
    metadata: {
      coupon_id: coupon.id,
      amount: coupon.amount,
      by_admin: !memberId,
      // False when GHL had already lost it — worth seeing, since it means a
      // coupon was removed outside this app.
      existed_at_ghl: !!live,
    },
  })

  return {
    ok: true,
    coupon: (settled as CreditCoupon) ?? { ...coupon, status: 'void' },
    summary: await loadCreditSummary(admin, coupon.member_id),
  }
}

/**
 * Bring open coupons in line with GHL: mark the used ones spent, and void the
 * ones that never reached GHL so their credit goes back.
 *
 * GHL doesn't tell us when a coupon is redeemed, so this is a pull — run when an
 * admin opens the coupon list, and when a member looks at their wallet. Entirely
 * best-effort: a GHL outage leaves the rows as they were rather than failing the
 * page that called it.
 *
 * It no longer sweeps up expired codes, because codes no longer expire; a legacy
 * row still carrying a date is the one exception (see couponSettlementOutcome).
 */
export async function syncCreditCoupons(params: {
  admin: AdminClient
  /** Restrict to one member's codes; omitted syncs every open coupon. */
  memberId?: string
  /** Safety valve on how many GHL round-trips one page load can cause. */
  limit?: number
}): Promise<{ checked: number; settled: number }> {
  const { admin, memberId } = params

  // Oldest first: codes no longer carry an expiry to prioritise by, and a code
  // that has been outstanding longest is the one most likely to have been used
  // or abandoned. Matches credit_coupons_open_idx.
  let query = admin
    .from('credit_coupons')
    .select('id, code, ghl_coupon_id, expires_at, member_id')
    .eq('status', 'issued')
    .order('created_at', { ascending: true })
    .limit(params.limit ?? 50)

  if (memberId) query = query.eq('member_id', memberId)

  const { data } = await query
  const open = data ?? []
  if (open.length === 0) return { checked: 0, settled: 0 }

  const now = new Date()
  let settled = 0

  // Sequential on purpose: this runs inside a page load and a burst of parallel
  // GHL calls is the kind of thing that gets an API key rate-limited.
  for (const row of open) {
    try {
      const hadGhlId = !!row.ghl_coupon_id
      const ghl = await getGhlCoupon({ id: row.ghl_coupon_id, code: row.code })

      // Found by code but with no id on our side: the coupon was created and
      // the id never got stored. Record it now, or nothing can delete this
      // coupon later.
      if (ghl && !hadGhlId) {
        await admin.rpc('attach_credit_coupon_ghl_id', {
          p_coupon_id: row.id,
          p_ghl_coupon_id: ghl._id,
        })
      }

      const outcome = couponSettlementOutcome({
        ghl,
        hadGhlId,
        expiresAt: row.expires_at as string,
        now,
      })
      if (!outcome) continue

      const { error } = await admin.rpc('settle_credit_coupon', {
        p_coupon_id: row.id,
        p_outcome: outcome,
        p_usage_count: ghl?.usageCount ?? 0,
        p_reason: outcome === 'void'
          ? 'Credit code never reached the payment provider — credit returned'
          : null,
        p_created_by: null,
      })
      if (!error) settled++
    } catch {
      // One unreachable coupon shouldn't stop the rest being reconciled.
      continue
    }
  }

  if (settled > 0) {
    logger.info('Credit coupons synced', {
      action: 'credit.coupons_synced',
      metadata: { checked: open.length, settled, member_id: memberId ?? null },
    })
  }

  return { checked: open.length, settled }
}
