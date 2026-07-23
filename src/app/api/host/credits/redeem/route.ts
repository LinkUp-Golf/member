export const dynamic = 'force-dynamic'

// POST /api/host/credits/redeem — spend available credit. The redeem_host_credit
// RPC checks the live balance under an advisory lock, so two concurrent
// redemptions can't overspend.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withHostAuth, type HostAuthContext } from '@/lib/auth/with-host-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { loadCreditSummary } from '@/lib/hosts/credits'
import { sanitiseText } from '@/lib/validation'
import { sendPushToMember, NotificationTemplates } from '@/lib/push'
import { logger } from '@/lib/logger'

export const POST = withHostAuth(async (req: NextRequest, ctx: HostAuthContext) => {
  const body = await req.json().catch(() => ({})) as { amount?: number; note?: string }

  const amount = Number(body.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'Enter an amount greater than zero.' }, { status: 400 })
  }
  const note = typeof body.note === 'string' && body.note.trim() ? sanitiseText(body.note.trim()) : null

  const admin = createAdminClient()

  const { error } = await admin.rpc('redeem_host_credit', {
    p_host_id: ctx.host.id,
    p_amount: amount,
    p_note: note,
    p_created_by: ctx.memberId,
  })

  if (error) {
    // P0001 messages from the function: INSUFFICIENT_BALANCE:<bal>, INVALID_AMOUNT.
    if (error.message?.startsWith('INSUFFICIENT_BALANCE')) {
      return NextResponse.json({ error: 'That exceeds your available balance.' }, { status: 409 })
    }
    if (error.message?.startsWith('INVALID_AMOUNT')) {
      return NextResponse.json({ error: 'Enter an amount greater than zero.' }, { status: 400 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (ctx.host.member_id) {
    void sendPushToMember(ctx.host.member_id, NotificationTemplates.hostCreditRedeemed(amount)).catch(() => {})
  }

  logger.info('Host credit redeemed', {
    action: 'host.credit.redeemed',
    userId: ctx.userId,
    metadata: { host_id: ctx.host.id, amount },
  })

  const summary = await loadCreditSummary(admin, ctx.host.id)
  return NextResponse.json({ ok: true, summary })
})
