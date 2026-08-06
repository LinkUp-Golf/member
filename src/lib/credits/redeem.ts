// ============================================================
// LinkUp Golf — Credit redemption
// Server-only: sends notifications, so it reaches supabase-server. Kept out of
// ./index because client components import the pure helpers there and would
// otherwise pull next/headers into their bundle.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { sanitiseText } from '@/lib/validation'
import { sendPushToMember, sendPushToAdmins, NotificationTemplates } from '@/lib/push'
import { logger } from '@/lib/logger'
import { loadCreditSummary } from './index'
import type { CreditSummary, CreditPurpose } from '@/types'

type AdminClient = SupabaseClient

// Only 'golf' can still be written. 'membership' stays in CreditPurpose because
// past redemptions used it and the history still renders them.
const REDEEMABLE_PURPOSE: CreditPurpose = 'golf'

export type RedeemResult =
  | { ok: true; summary: CreditSummary }
  | { ok: false; status: number; error: string }

/**
 * Spend credit from a member's wallet toward golf.
 *
 * Shared by the host and partner workspaces: the wallet is the member's, so the
 * two role-gated routes differ only in who they let in and what name the admin
 * notification carries — not in the money handling, which must not fork.
 *
 * Requires an active membership, enforced inside the RPC (see
 * 20260806000002_redeem_requires_membership.sql) so neither workspace can be the
 * way around it. Earning is not gated — a non-member host or partner accrues a
 * balance they can spend once they join. That gate is also why redemption no
 * longer asks golf-or-membership: everyone who can redeem is already a member.
 *
 * A redemption is a request an admin then settles by putting it against a round,
 * which is why they're notified here.
 */
export async function redeemCredit(params: {
  admin: AdminClient
  /** Whose wallet, and who is recorded as having made the redemption. */
  memberId: string
  /** Display name used in the admin notification. */
  actorName: string
  amount: unknown
  purpose: unknown
  note: unknown
  /** For the audit log — which workspace the redemption came from. */
  context: Record<string, unknown>
}): Promise<RedeemResult> {
  const { admin, memberId, actorName } = params

  const amount = Number(params.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, status: 400, error: 'Enter an amount greater than zero.' }
  }

  // Nothing asks any more, so an absent purpose is the normal case. A stale
  // service-worker cache can still be serving the old two-choice form though,
  // and "invalid purpose" would be a baffling thing for that person to read.
  const purpose = params.purpose == null || params.purpose === '' ? REDEEMABLE_PURPOSE : params.purpose
  if (purpose !== REDEEMABLE_PURPOSE) {
    return {
      ok: false,
      status: 400,
      error: 'Credit is redeemed toward golf. Reload the app if you were offered another option.',
    }
  }

  const note = typeof params.note === 'string' && params.note.trim()
    ? sanitiseText(params.note.trim())
    : null

  const { error } = await admin.rpc('redeem_member_credit', {
    p_member_id: memberId,
    p_amount: amount,
    p_purpose: purpose,
    p_note: note,
    p_created_by: memberId,
  })

  if (error) {
    // P0001 messages from the function: INSUFFICIENT_BALANCE:<bal>,
    // INVALID_AMOUNT, INVALID_PURPOSE, NOT_A_MEMBER.
    if (error.message?.startsWith('NOT_A_MEMBER')) {
      return {
        ok: false,
        status: 403,
        error: 'Redeeming credit needs an active LinkUp membership. Your balance keeps building until then.',
      }
    }
    if (error.message?.startsWith('INSUFFICIENT_BALANCE')) {
      return { ok: false, status: 409, error: 'That exceeds your available balance.' }
    }
    if (error.message?.startsWith('INVALID_AMOUNT')) {
      return { ok: false, status: 400, error: 'Enter an amount greater than zero.' }
    }
    if (error.message?.startsWith('INVALID_PURPOSE')) {
      return { ok: false, status: 400, error: 'Credit is redeemed toward golf.' }
    }
    logger.error('Credit redeem failed', {
      action: 'credit.redeemed',
      userId: memberId,
      metadata: { ...params.context, error: error.message },
    })
    return { ok: false, status: 500, error: 'Could not redeem your credits.' }
  }

  void sendPushToMember(memberId, NotificationTemplates.creditRedeemed(amount)).catch(() => {})
  // Nothing else tells the admins a redemption is waiting to be settled.
  void sendPushToAdmins(
    NotificationTemplates.creditRedemptionRequested(actorName, amount)
  ).catch(() => {})

  logger.info('Member credit redeemed', {
    action: 'credit.redeemed',
    userId: memberId,
    metadata: { ...params.context, amount, purpose },
  })

  return { ok: true, summary: await loadCreditSummary(admin, memberId) }
}
