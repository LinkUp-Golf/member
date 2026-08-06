export const dynamic = 'force-dynamic'

// The same walk the hourly cron does — every access-tagged GHL contact, a
// handful of GHL + Supabase calls each — so it needs the same budget. 300s is
// the Vercel ceiling; a run cut short is safe (see bulk.ts).
export const maxDuration = 300

// ============================================================
// POST /api/admin/sync
// Runs the GHL → Supabase member reconcile on demand.
//
// The hourly cron (/api/cron/ghl-member-sync) does this on its own; this is for
// when an admin has just changed something in GHL and doesn't want to wait up
// to an hour to see it. Same function behind both, so the two can't drift.
//
// Idempotent, so an admin clicking this while the cron happens to be running
// costs duplicated GHL calls and nothing else — both runs converge on the same
// state. Not worth a distributed lock.
// ============================================================

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { runBulkGhlSync } from '@/lib/sync/bulk'
import { logger } from '@/lib/logger'
import type { AuthContext } from '@/lib/auth/types'

export const POST = withAuth(
  async (_req: NextRequest, ctx: AuthContext) => {
    const startedAt = Date.now()

    try {
      const result = await runBulkGhlSync()

      logger.info('Manual GHL member sync ran', {
        action: 'admin.ghl_member_sync',
        userId: ctx.userId,
        metadata: { ...result, errors: result.errors.length, durationMs: Date.now() - startedAt },
      })

      // Per-contact errors are partial and expected — the run itself succeeded,
      // so they're reported in the body rather than as a failed request.
      return NextResponse.json(result)
    } catch (err) {
      logger.error('Manual GHL member sync failed', {
        action: 'admin.ghl_member_sync',
        userId: ctx.userId,
        metadata: { error: String(err), durationMs: Date.now() - startedAt },
      })
      return NextResponse.json({ error: 'Sync failed. Check the logs and try again.' }, { status: 500 })
    }
  },
  { requireAdmin: true, skipGHLCheck: true }
)
