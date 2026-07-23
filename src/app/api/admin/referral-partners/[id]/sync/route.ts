export const dynamic = 'force-dynamic'

// POST /api/admin/referral-partners/[id]/sync — re-pull GHL tags for every
// member this partner referred, so the payout figures reflect who currently
// holds a membership. Recording a payment does this automatically; this lets an
// admin refresh the displayed numbers before deciding.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { syncPartnerReferredMembers } from '@/lib/referral-sync'
import type { AuthContext } from '@/lib/auth/types'

export const POST = withAuth(
  async (_req: NextRequest, ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing partner id' }, { status: 400 })

    const admin = createAdminClient()
    const { refreshed, failed } = await syncPartnerReferredMembers(admin, id, ctx.requestId)
    return NextResponse.json({ ok: true, refreshed, failed })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
