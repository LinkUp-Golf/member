export const dynamic = 'force-dynamic'

// GET /api/host/credits — the caller's credit summary and full ledger history.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withHostAuth, type HostAuthContext } from '@/lib/auth/with-host-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { loadCreditSummary, loadCreditEntries } from '@/lib/hosts/credits'

export const GET = withHostAuth(async (_req: NextRequest, ctx: HostAuthContext) => {
  const admin = createAdminClient()
  const [summary, entries] = await Promise.all([
    loadCreditSummary(admin, ctx.host.id),
    loadCreditEntries(admin, ctx.host.id),
  ])
  return NextResponse.json({ summary, entries })
})
