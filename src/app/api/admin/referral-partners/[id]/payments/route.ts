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

    const { periods } = await loadPayoutSummary(admin, partner)
    const period = periods.find(p => p.periodMonth === periodMonth)

    if (!period) {
      return NextResponse.json({ error: 'No commission was earned in that month.' }, { status: 400 })
    }
    if (period.paid) {
      return NextResponse.json({ error: `${formatPeriod(periodMonth)} has already been paid.` }, { status: 409 })
    }

    // Default to the calculated figure; an explicit amount lets the admin
    // record a partial or adjusted payment without rewriting the maths.
    const amount = body.amount === undefined ? period.total : Number(body.amount)
    if (!Number.isFinite(amount) || amount < 0) {
      return NextResponse.json({ error: 'Amount must be a positive number' }, { status: 400 })
    }

    const { data: payment, error } = await admin
      .from('referral_partner_payments')
      .insert({
        referral_partner_id: id,
        period_month: periodMonth,
        calculated_amount: period.total,
        amount,
        conversion_count: period.conversions.length,
        note: body.note?.trim() || null,
        paid_by: ctx.userId,
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: `${formatPeriod(periodMonth)} has already been paid.` },
          { status: 409 }
        )
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Snapshot the covered conversions. Commission is otherwise derived from
    // live member rows and the partner's current rate, so without this a later
    // rate change would rewrite what this payment was for.
    if (period.conversions.length) {
      const { error: itemsError } = await admin
        .from('referral_partner_payment_items')
        .insert(period.conversions.map(c => ({
          payment_id: payment.id,
          link_id: c.linkId,
          email: c.email,
          name: c.name,
          converted_at: c.convertedAt,
          commission: c.commission,
        })))

      if (itemsError) {
        // Without its line items the payment isn't auditable, and the
        // link-level unique index may be what rejected it — meaning one of
        // these conversions was already paid in another month. Roll back.
        await admin.from('referral_partner_payments').delete().eq('id', payment.id)
        return NextResponse.json(
          { error: 'Could not record the covered referrals — some may already have been paid.' },
          { status: 409 }
        )
      }
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
