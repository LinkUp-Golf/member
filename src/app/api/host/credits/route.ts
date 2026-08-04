export const dynamic = 'force-dynamic'

// GET /api/host/credits — the caller's credit summary and full ledger history.
// The wallet is the member's, not the host row's, so a host who also earned
// credit another way (a referral payout) sees one balance here.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withHostAuth, type HostAuthContext } from '@/lib/auth/with-host-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { loadCreditSummary, loadCreditEntries } from '@/lib/credits'

export const GET = withHostAuth(async (_req: NextRequest, ctx: HostAuthContext) => {
  const admin = createAdminClient()
  const [summary, entries] = await Promise.all([
    loadCreditSummary(admin, ctx.memberId),
    loadCreditEntries(admin, ctx.memberId),
  ])
  return NextResponse.json({ summary, entries })
})
