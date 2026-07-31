export const dynamic = 'force-dynamic'

// Bulk sync walks every access-tagged GHL contact and makes a handful of GHL +
// Supabase calls each, so it needs far longer than the default function budget.
// 300s is the Vercel ceiling; a run cut short here is safe (see bulk.ts).
export const maxDuration = 300

// ============================================================
// GET /api/cron/ghl-member-sync
// Runs hourly (vercel.json: "0 * * * *"). Reconciles Supabase members against
// GHL — imports newly tagged contacts and deactivates members whose access tag
// was removed — replacing the admin "Sync from GHL" button this used to need.
//
// Idempotent, so a retried or overlapping run is harmless.
//
// Test locally:
//   curl -H "Authorization: Bearer <CRON_SECRET>" \
//     http://localhost:3000/api/cron/ghl-member-sync
// ============================================================

import { type NextRequest, NextResponse } from 'next/server'
import { runBulkGhlSync } from '@/lib/sync/bulk'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  // Fail closed when the secret isn't configured — otherwise the comparison
  // would succeed against the literal string "Bearer undefined".
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const startedAt = Date.now()

  try {
    const result = await runBulkGhlSync()
    logger.info('ghl-member-sync cron ran', {
      action: 'cron.ghl_member_sync',
      metadata: { ...result, errors: result.errors.length, durationMs: Date.now() - startedAt },
    })
    // Errors here are per-contact and expected to be partial — the run itself
    // succeeded, so don't fail the cron (and trigger a Vercel retry) over them.
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    logger.error('ghl-member-sync cron failed', {
      action: 'cron.ghl_member_sync',
      metadata: { error: String(err), durationMs: Date.now() - startedAt },
    })
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 })
  }
}
