export const dynamic = 'force-dynamic'

// GET /api/partner/credits — the caller's credit summary and ledger history.
//
// Commission is paid as credit, so a partner needs the same wallet view a host
// has. It's the same member-scoped wallet behind both: a partner who also hosts
// sees one balance, not two.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withPartnerAuth, type PartnerAuthContext } from '@/lib/auth/with-partner-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { loadCreditSummary, loadCreditEntries } from '@/lib/credits'

export const GET = withPartnerAuth(async (_req: NextRequest, ctx: PartnerAuthContext) => {
  const admin = createAdminClient()
  const [summary, entries] = await Promise.all([
    loadCreditSummary(admin, ctx.memberId),
    loadCreditEntries(admin, ctx.memberId),
  ])
  return NextResponse.json({ summary, entries })
})
