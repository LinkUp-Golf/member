export const dynamic = 'force-dynamic'

// GET /api/host/credits — the caller's credit summary and full ledger history.
// The wallet is the member's, not the host row's, so a host who also earned
// credit another way (a referral payout) sees one balance here.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withHostAuth, type HostAuthContext } from '@/lib/auth/with-host-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { loadCreditSummary, loadCreditEntries, canRedeemCredit } from '@/lib/credits'

export const GET = withHostAuth(async (_req: NextRequest, ctx: HostAuthContext) => {
  const admin = createAdminClient()
  // canRedeem lets the wallet explain a disabled button rather than letting the
  // host fill the form in and be refused on submit. The RPC still enforces it.
  const [summary, entries, canRedeem] = await Promise.all([
    loadCreditSummary(admin, ctx.memberId),
    loadCreditEntries(admin, ctx.memberId),
    canRedeemCredit(admin, ctx.memberId),
  ])
  return NextResponse.json({ summary, entries, canRedeem })
})
