export const dynamic = 'force-dynamic'

// GET  /api/admin/referral-partners/[id]/payments — the partner's commission
//        balance: what's accrued (recurring, per referred member), what's been
//        paid, and what's outstanding.
// POST /api/admin/referral-partners/[id]/payments — record a payout of the
//        outstanding balance (cash or coupon). Only allowed once the balance
//        clears the payout threshold; commission is paid outside the app.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { loadPartnerCommission } from '@/lib/referral-commission'
import { monthOf } from '@/lib/referral-rate'
import { PAYOUT_THRESHOLD_USD } from '@/lib/constants'
import { syncPartnerReferredMembers } from '@/lib/referral-sync'
import { sendPushToMember, NotificationTemplates } from '@/lib/push'
import { logger } from '@/lib/logger'
import type { AuthContext } from '@/lib/auth/types'
import type { ReferralPartner } from '@/types'

const fmtMoney = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 })

async function getPartner(admin: ReturnType<typeof createAdminClient>, id: string) {
  const { data } = await admin.from('referral_partners').select('*').eq('id', id).single()
  return (data ?? null) as ReferralPartner | null
}

export const GET = withAuth(
  async (_req: NextRequest, _ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing partner id' }, { status: 400 })

    const admin = createAdminClient()
    const partner = await getPartner(admin, id)
    if (!partner) return NextResponse.json({ error: 'Referral partner not found' }, { status: 404 })

    const summary = await loadPartnerCommission(admin, partner)
    return NextResponse.json({ partner, ...summary })
  },
  { requireAdmin: true, skipGHLCheck: true }
)

export const POST = withAuth(
  async (req: NextRequest, ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing partner id' }, { status: 400 })

    const body = await req.json().catch(() => ({})) as {
      amount?: number
      method?: string
      reference?: string
      note?: string
    }

    const admin = createAdminClient()
    const partner = await getPartner(admin, id)
    if (!partner) return NextResponse.json({ error: 'Referral partner not found' }, { status: 404 })

    // Membership drives accrual and lives in GHL, so refresh this partner's
    // referred members first. Fail closed on a total outage (every lookup threw)
    // rather than pay on stale membership state; a partial success proceeds.
    const sync = await syncPartnerReferredMembers(admin, id, ctx.requestId)
    if (sync.failed > 0 && sync.refreshed === 0) {
      return NextResponse.json(
        { error: 'Could not verify current membership with GHL. Please try again in a moment.' },
        { status: 503 }
      )
    }

    const { balance } = await loadPartnerCommission(admin, partner)

    if (balance.outstanding < PAYOUT_THRESHOLD_USD) {
      return NextResponse.json(
        { error: `Balance is ${fmtMoney(balance.outstanding)} — below the ${fmtMoney(PAYOUT_THRESHOLD_USD)} payout threshold. It rolls over.` },
        { status: 400 }
      )
    }

    // Default to settling the whole balance; an explicit amount lets the admin
    // record a partial payout. Never more than what's outstanding.
    const amount = body.amount == null ? balance.outstanding : Number(body.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'Amount must be a positive number' }, { status: 400 })
    }
    if (amount > balance.outstanding + 0.005) {
      return NextResponse.json({ error: `Amount exceeds the ${fmtMoney(balance.outstanding)} outstanding.` }, { status: 400 })
    }

    const method = body.method === 'coupon' ? 'coupon' : body.method === 'cash' ? 'cash' : partner.payout_method
    const reference = body.reference?.trim() || null

    const { data: payment, error } = await admin.rpc('record_referral_payout', {
      p_partner_id: id,
      p_accrued: balance.totalAccrued,
      p_amount: amount,
      p_method: method,
      p_reference: reference,
      p_note: body.note?.trim() || null,
      p_paid_by: ctx.userId,
      p_period_month: monthOf(new Date().toISOString()),
    })

    if (error) {
      // Raised by the RPC when a concurrent payout already settled this balance.
      if (error.message?.includes('OVERPAY')) {
        return NextResponse.json({ error: 'This balance was just paid out. Refresh to see the latest.' }, { status: 409 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (partner.member_id) {
      void sendPushToMember(
        partner.member_id,
        NotificationTemplates.referralCommissionPaid(amount, method)
      ).catch(() => {})
    }

    logger.info('Referral commission payout recorded', {
      action: 'referral_partner.payout.recorded',
      userId: ctx.userId,
      metadata: { partner_id: id, amount, method },
    })

    return NextResponse.json({ payment }, { status: 201 })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
