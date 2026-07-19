export const dynamic = 'force-dynamic'

// GET /api/partner/overview — the caller's own partner row, stats, and
// conversion breakdown. The partner-scoped mirror of
// /api/admin/referral-partners/[id]/analytics.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withPartnerAuth, type PartnerAuthContext } from '@/lib/auth/with-partner-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { loadPartnerConversions, statsFromLoaded, emptyStats } from '@/lib/referral-partners'
import { MEMBERSHIP_FEE_USD } from '@/lib/constants'

export const GET = withPartnerAuth(async (_req: NextRequest, ctx: PartnerAuthContext) => {
  const admin = createAdminClient()
  const { partner } = ctx

  const { links, conversions } = await loadPartnerConversions(admin, [partner])
  const stats = statsFromLoaded([partner], links, conversions).get(partner.id) ?? emptyStats()
  const conversionRate = stats.referredCount ? stats.activeCount / stats.referredCount : 0

  return NextResponse.json({
    partner,
    stats,
    conversionRate,
    membershipFee: MEMBERSHIP_FEE_USD,
    conversions: conversions.get(partner.id) ?? [],
  })
})
