export const dynamic = 'force-dynamic'

// ============================================================
// GET /api/cron/hosted-events-complete
// Runs daily (vercel.json). Moves upcoming hosted events whose date has passed
// to 'completed', so the host can then upload proof and earn their credit.
//
// The status transition itself is the idempotency guard: only 'upcoming' rows
// with a past date are touched, so re-running is a no-op.
//
// Test locally:
//   curl -H "Authorization: Bearer <CRON_SECRET>" \
//     http://localhost:3000/api/cron/hosted-events-complete
// ============================================================

import { type NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  // Fail closed when the secret isn't configured — otherwise the comparison
  // would succeed against the literal string "Bearer undefined".
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const admin = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)

  const { data, error } = await admin
    .from('hosted_events')
    .update({ status: 'completed' })
    .eq('status', 'upcoming')
    .lt('event_date', today)
    .select('id')

  if (error) {
    logger.error('hosted-events-complete cron failed', { action: 'cron.hosted_events_complete', metadata: { error: error.message } })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const completed = data?.length ?? 0

  // A host may upload proof on the day of the round, while the event is still
  // `upcoming` — the proof route deliberately leaves the status alone then, so the
  // live event isn't delisted mid-day. Those events land in `completed` above, so
  // this is where they enter the credit queue. Without it a same-day proof would
  // sit in `completed` and never reach an admin.
  const completedIds = (data ?? []).map(e => e.id)
  let queuedForCredit = 0

  if (completedIds.length) {
    const { data: proofed } = await admin
      .from('hosted_event_proofs')
      .select('hosted_event_id')
      .in('hosted_event_id', completedIds)

    const proofedIds = [...new Set((proofed ?? []).map(p => p.hosted_event_id))]
    if (proofedIds.length) {
      const { data: queued, error: queueError } = await admin
        .from('hosted_events')
        .update({ status: 'pending_credit_approval' })
        .in('id', proofedIds)
        .eq('status', 'completed')
        .select('id')

      if (queueError) {
        // Non-fatal: the events are correctly `completed`, and the host can
        // re-upload to queue them. Log so the gap is visible.
        logger.warn('hosted-events-complete could not queue proofed events', {
          action: 'cron.hosted_events_complete.queue_failed',
          metadata: { error: queueError.message, count: proofedIds.length },
        })
      } else {
        queuedForCredit = queued?.length ?? 0
      }
    }
  }

  logger.info('hosted-events-complete cron ran', {
    action: 'cron.hosted_events_complete',
    metadata: { completed, queuedForCredit },
  })
  return NextResponse.json({ ok: true, completed, queuedForCredit })
}
