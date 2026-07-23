export const dynamic = 'force-dynamic'

// GET /api/partner/overview — the caller's own partner row, stats, and
// conversion breakdown. The partner-scoped mirror of
// /api/admin/referral-partners/[id]/analytics.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withPartnerAuth, type PartnerAuthContext } from '@/lib/auth/with-partner-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { loadPartnerConversions, statsFromLoaded, emptyStats } from '@/lib/referral-partners'
import { loadPartnerCommission } from '@/lib/referral-commission'
import { MEMBERSHIP_FEE_USD } from '@/lib/constants'

export const GET = withPartnerAuth(async (_req: NextRequest, ctx: PartnerAuthContext) => {
  const admin = createAdminClient()
  const { partner } = ctx

  // Counts (referred / active / conversion rate) come from the link + conversion
  // loader; commission is the recurring accrual balance.
  const [{ links, conversions }, commission] = await Promise.all([
    loadPartnerConversions(admin, [partner]),
    loadPartnerCommission(admin, partner),
  ])
  const stats = statsFromLoaded([partner], links, conversions).get(partner.id) ?? emptyStats()
  // Report commission as the recurring total accrued to date, not the old
  // one-time figure.
  stats.commissionOwed = commission.balance.totalAccrued
  const conversionRate = stats.referredCount ? stats.activeCount / stats.referredCount : 0

  return NextResponse.json({
    partner,
    stats,
    conversionRate,
    membershipFee: MEMBERSHIP_FEE_USD,
    balance: commission.balance,
    monthlyRate: commission.monthlyRate,
    accruals: commission.accruals,
  })
})
