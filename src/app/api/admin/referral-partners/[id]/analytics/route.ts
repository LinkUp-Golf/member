export const dynamic = 'force-dynamic'

// GET /api/admin/referral-partners/[id]/analytics
// Returns the partner + its link/conversion breakdown and commission owed.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { computeStatsForPartners, emptyStats } from '@/lib/referral-partners'
import { MEMBERSHIP_FEE_USD } from '@/lib/constants'
import type { AuthContext } from '@/lib/auth/types'
import type { ReferralPartner } from '@/types'

export const GET = withAuth(
  async (_req: NextRequest, _ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing partner id' }, { status: 400 })

    const admin = createAdminClient()
    const { data: partner, error } = await admin
      .from('referral_partners').select('*').eq('id', id).single()
    if (error || !partner) return NextResponse.json({ error: 'Referral partner not found' }, { status: 404 })

    const p = partner as ReferralPartner
    const stats = (await computeStatsForPartners(admin, [p])).get(id) ?? emptyStats()
    const conversionRate = stats.linkedCount ? stats.convertedCount / stats.linkedCount : 0

    return NextResponse.json({
      partner: p,
      stats,
      conversionRate,
      membershipFee: MEMBERSHIP_FEE_USD,
    })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
