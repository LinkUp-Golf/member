export const dynamic = 'force-dynamic'

// GET  /api/admin/referral-partners  — list partners with link/conversion stats
// POST /api/admin/referral-partners  — create a partner (auto-slug the code)

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { validateReferralPartnerPayload } from '@/lib/validation'
import { DEFAULT_REFERRAL_PERCENTAGE } from '@/lib/constants'
import { computeStatsForPartners, emptyStats } from '@/lib/referral-partners'
import { loadPartnerCommission } from '@/lib/referral-commission'
import type { AuthContext } from '@/lib/auth/types'
import type { ReferralPartner } from '@/types'

function toSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export const GET = withAuth(
  async (_req: NextRequest, _ctx: AuthContext) => {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('referral_partners')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const partners = (data ?? []) as ReferralPartner[]
    const stats = await computeStatsForPartners(admin, partners)
    // commissionOwed is the recurring balance (accrued to date), not the old
    // one-time figure — computed per partner from live membership dates.
    const balances = await Promise.all(partners.map(p => loadPartnerCommission(admin, p)))
    const withStats = partners.map((p, i) => ({
      ...p,
      ...(stats.get(p.id) ?? emptyStats()),
      commissionOwed: balances[i]?.balance.totalAccrued ?? 0,
    }))

    return NextResponse.json({ partners: withStats })
  },
  { requireAdmin: true, skipGHLCheck: true }
)

export const POST = withAuth(
  async (req: NextRequest, ctx: AuthContext) => {
    const body = await req.json() as Partial<ReferralPartner>

    const name = body.name?.trim() ?? ''
    const code = (body.code?.trim() || toSlug(name))
    const percentage = body.percentage ?? DEFAULT_REFERRAL_PERCENTAGE
    // Empty string from the date input means "no expiry", same as omitting it.
    const endsAt = body.ends_at?.trim() || null
    const payoutMethod = body.payout_method === 'coupon' ? 'coupon' : 'cash'

    const { valid, errors } = validateReferralPartnerPayload({ name, code, percentage, ends_at: endsAt })
    if (!valid) return NextResponse.json({ error: errors[0] }, { status: 400 })

    const admin = createAdminClient()

    // Code uniqueness pre-check (constraint is the race-safe backstop below)
    const { data: existing } = await admin
      .from('referral_partners').select('id').eq('code', code).limit(1)
    if (existing?.length) {
      return NextResponse.json({ error: `The code "${code}" is already taken. Choose a different one.` }, { status: 409 })
    }

    const { data, error } = await admin
      .from('referral_partners')
      .insert({
        name,
        code,
        percentage,
        ends_at: endsAt,
        payout_method: payoutMethod,
        created_by: ctx.userId,
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: `The code "${code}" is already taken. Choose a different one.` }, { status: 409 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ partner: data }, { status: 201 })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
