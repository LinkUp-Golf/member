export const dynamic = 'force-dynamic'

// GET  /api/admin/referral-partners/[id]/payments — monthly commission
//        breakdown: what's owed per month and what's already been paid.
// POST /api/admin/referral-partners/[id]/payments — record a manual payment
//        for one month. Commission is paid outside the app; this is the ledger.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { loadPayoutSummary, monthOf, formatPeriod } from '@/lib/referral-payouts'
import { syncPartnerReferredMembers } from '@/lib/referral-sync'
import { sendPushToMember, NotificationTemplates } from '@/lib/push'
import { logger } from '@/lib/logger'
import type { AuthContext } from '@/lib/auth/types'
import type { ReferralPartner } from '@/types'

const MONTH_RE = /^\d{4}-\d{2}(-\d{2})?$/

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

    const summary = await loadPayoutSummary(admin, partner)
    return NextResponse.json({ partner, ...summary })
  },
  { requireAdmin: true, skipGHLCheck: true }
)

export const POST = withAuth(
  async (req: NextRequest, ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing partner id' }, { status: 400 })

    const body = await req.json().catch(() => ({})) as {
      period_month?: string
      amount?: number
      note?: string
    }

    if (!body.period_month || !MONTH_RE.test(body.period_month)) {
      return NextResponse.json({ error: 'period_month must be YYYY-MM' }, { status: 400 })
    }
    const periodMonth = monthOf(`${body.period_month.slice(0, 7)}-01`)

    const admin = createAdminClient()
    const partner = await getPartner(admin, id)
    if (!partner) return NextResponse.json({ error: 'Referral partner not found' }, { status: 404 })

    // Membership lives in GHL, so refresh this partner's referred members from
    // GHL before computing the payout — a payment must reflect who currently
    // holds a membership, not who did at the last sync. Fail closed: if the
    // refresh reached no one (a GHL outage — every lookup threw), refuse rather
    // than pay on stale tags. A partial success still proceeds.
    const sync = await syncPartnerReferredMembers(admin, id, ctx.requestId)
    if (sync.failed > 0 && sync.refreshed === 0) {
      return NextResponse.json(
        { error: 'Could not verify current membership with GHL. Please try again in a moment.' },
        { status: 503 }
      )
    }

    const { periods } = await loadPayoutSummary(admin, partner)
    const period = periods.find(p => p.periodMonth === periodMonth)

    if (!period) {
      return NextResponse.json({ error: 'No commission was earned in that month.' }, { status: 400 })
    }
    if (period.paid) {
      return NextResponse.json({ error: `${formatPeriod(periodMonth)} has already been paid.` }, { status: 409 })
    }

    // Default to the calculated figure; an explicit amount lets the admin
    // record a partial or adjusted payment without rewriting the maths. `== null`
    // catches both undefined and an explicit null so neither records a $0 payment.
    const amount = body.amount == null ? period.total : Number(body.amount)
    if (!Number.isFinite(amount) || amount < 0) {
      return NextResponse.json({ error: 'Amount must be a positive number' }, { status: 400 })
    }

    // The payment row and its line-item snapshot are written in one transaction
    // (record_referral_payment): a conversion already paid in another month
    // trips the per-link unique index and rolls the whole payment back, so a
    // paid month can never exist without its items.
    const { data: payment, error } = await admin.rpc('record_referral_payment', {
      p_partner_id: id,
      p_period_month: periodMonth,
      p_calculated_amount: period.total,
      p_amount: amount,
      p_note: body.note?.trim() || null,
      p_paid_by: ctx.userId,
      p_items: period.conversions.map(c => ({
        link_id: c.linkId,
        email: c.email,
        name: c.name,
        converted_at: c.convertedAt,
        commission: c.commission,
      })),
    })

    if (error) {
      // 23505 = the (partner, month) unique or the per-link unique — this month,
      // or one of its referrals, has already been paid.
      if (error.code === '23505') {
        return NextResponse.json(
          { error: `${formatPeriod(periodMonth)}, or one of its referrals, has already been paid.` },
          { status: 409 }
        )
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (partner.member_id) {
      void sendPushToMember(
        partner.member_id,
        NotificationTemplates.referralCommissionPaid(amount, formatPeriod(periodMonth))
      ).catch(() => {})
    }

    logger.info('Referral commission payment recorded', {
      action: 'referral_partner.payment.recorded',
      userId: ctx.userId,
      metadata: { partner_id: id, period_month: periodMonth, amount },
    })

    return NextResponse.json({ payment }, { status: 201 })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
