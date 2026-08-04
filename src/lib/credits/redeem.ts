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

const PURPOSES: readonly CreditPurpose[] = ['golf', 'membership']

export type RedeemResult =
  | { ok: true; summary: CreditSummary }
  | { ok: false; status: number; error: string }

/**
 * Spend credit from a member's wallet on golf or membership.
 *
 * Shared by the host and partner workspaces: the wallet is the member's, so the
 * two role-gated routes differ only in who they let in and what name the admin
 * notification carries — not in the money handling, which must not fork.
 *
 * A redemption is a request an admin then settles (book the round, put it
 * against the membership fee), which is why they're notified here.
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

  const purpose = PURPOSES.find(p => p === params.purpose)
  if (!purpose) {
    return { ok: false, status: 400, error: 'Choose whether this goes toward golf or membership.' }
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
    // INVALID_AMOUNT, INVALID_PURPOSE.
    if (error.message?.startsWith('INSUFFICIENT_BALANCE')) {
      return { ok: false, status: 409, error: 'That exceeds your available balance.' }
    }
    if (error.message?.startsWith('INVALID_AMOUNT')) {
      return { ok: false, status: 400, error: 'Enter an amount greater than zero.' }
    }
    if (error.message?.startsWith('INVALID_PURPOSE')) {
      return { ok: false, status: 400, error: 'Choose whether this goes toward golf or membership.' }
    }
    logger.error('Credit redeem failed', {
      action: 'credit.redeemed',
      userId: memberId,
      metadata: { ...params.context, error: error.message },
    })
    return { ok: false, status: 500, error: 'Could not redeem your credits.' }
  }

  void sendPushToMember(memberId, NotificationTemplates.creditRedeemed(amount, purpose)).catch(() => {})
  // Nothing else tells the admins a redemption is waiting to be settled.
  void sendPushToAdmins(
    NotificationTemplates.creditRedemptionRequested(actorName, amount, purpose)
  ).catch(() => {})

  logger.info('Member credit redeemed', {
    action: 'credit.redeemed',
    userId: memberId,
    metadata: { ...params.context, amount, purpose },
  })

  return { ok: true, summary: await loadCreditSummary(admin, memberId) }
}
