export const dynamic = 'force-dynamic'

// POST /api/host/credits/redeem — spend available credit on golf or membership.
// The redeem_member_credit RPC checks the live balance under a per-member
// advisory lock, so two concurrent redemptions can't overspend.
//
// A redemption is a request an admin then settles (book the round, put it
// against the membership fee). The purpose is required rather than left in a
// free-text note, so what the credit bought is recorded, not interpreted.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withHostAuth, type HostAuthContext } from '@/lib/auth/with-host-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { loadCreditSummary } from '@/lib/credits'
import { sanitiseText } from '@/lib/validation'
import { sendPushToMember, sendPushToAdmins, NotificationTemplates } from '@/lib/push'
import { logger } from '@/lib/logger'
import type { CreditPurpose } from '@/types'

const PURPOSES: readonly CreditPurpose[] = ['golf', 'membership']

export const POST = withHostAuth(async (req: NextRequest, ctx: HostAuthContext) => {
  const body = await req.json().catch(() => ({})) as {
    amount?: number
    purpose?: string
    note?: string
  }

  const amount = Number(body.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'Enter an amount greater than zero.' }, { status: 400 })
  }

  const purpose = PURPOSES.find(p => p === body.purpose)
  if (!purpose) {
    return NextResponse.json({ error: 'Choose whether this goes toward golf or membership.' }, { status: 400 })
  }

  const note = typeof body.note === 'string' && body.note.trim() ? sanitiseText(body.note.trim()) : null

  const admin = createAdminClient()

  const { error } = await admin.rpc('redeem_member_credit', {
    p_member_id: ctx.memberId,
    p_amount: amount,
    p_purpose: purpose,
    p_note: note,
    p_created_by: ctx.memberId,
  })

  if (error) {
    // P0001 messages from the function: INSUFFICIENT_BALANCE:<bal>,
    // INVALID_AMOUNT, INVALID_PURPOSE.
    if (error.message?.startsWith('INSUFFICIENT_BALANCE')) {
      return NextResponse.json({ error: 'That exceeds your available balance.' }, { status: 409 })
    }
    if (error.message?.startsWith('INVALID_AMOUNT')) {
      return NextResponse.json({ error: 'Enter an amount greater than zero.' }, { status: 400 })
    }
    if (error.message?.startsWith('INVALID_PURPOSE')) {
      return NextResponse.json({ error: 'Choose whether this goes toward golf or membership.' }, { status: 400 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  void sendPushToMember(ctx.memberId, NotificationTemplates.creditRedeemed(amount, purpose)).catch(() => {})

  // Nothing else tells the admins a redemption is waiting to be settled.
  void sendPushToAdmins(
    NotificationTemplates.creditRedemptionRequested(ctx.host.name, amount, purpose)
  ).catch(() => {})

  logger.info('Member credit redeemed', {
    action: 'credit.redeemed',
    userId: ctx.userId,
    metadata: { host_id: ctx.host.id, amount, purpose },
  })

  const summary = await loadCreditSummary(admin, ctx.memberId)
  return NextResponse.json({ ok: true, summary })
})
