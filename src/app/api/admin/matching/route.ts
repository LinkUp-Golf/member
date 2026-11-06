export const dynamic = 'force-dynamic'

// GET /api/admin/matching                 — the queue: members waiting for a match
// GET /api/admin/matching?q=sam           — any member, by name or email
// Both take ?offset=&limit= (default 20) and return { entries, total, surveyed }.
//
// Admin-only. See docs/playing-partner-matching.md.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { logger } from '@/lib/logger'
import { loadQueue, parsePage, searchMembers } from '@/lib/matching/queue'
import type { AuthContext } from '@/lib/auth/types'

export const GET = withAuth(
  async (req: NextRequest, _ctx: AuthContext) => {
    const admin = createAdminClient()
    const params = req.nextUrl.searchParams
    const q = params.get('q')?.trim() ?? ''
    const page = parsePage(params)
    try {
      return NextResponse.json(q ? await searchMembers(admin, q, page) : await loadQueue(admin, page))
    } catch (err) {
      logger.error('Matching queue failed', {
        action: 'admin.matching.queue',
        errorMessage: err instanceof Error ? err.message : String(err),
      })
      return NextResponse.json({ error: 'Could not load the matching queue.' }, { status: 500 })
    }
  },
  { requireAdmin: true, skipGHLCheck: true },
)
