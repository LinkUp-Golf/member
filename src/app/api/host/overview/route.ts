export const dynamic = 'force-dynamic'

// GET /api/host/overview — the caller's host dashboard: event statistics and
// credit summary (earned / redeemed / balance).

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withHostAuth, type HostAuthContext } from '@/lib/auth/with-host-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { loadHostStats } from '@/lib/hosts/events'

export const GET = withHostAuth(async (_req: NextRequest, ctx: HostAuthContext) => {
  const admin = createAdminClient()
  const stats = await loadHostStats(admin, ctx.host.id)
  return NextResponse.json({ host: ctx.host, stats })
})
