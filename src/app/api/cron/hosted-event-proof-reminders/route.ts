export const dynamic = 'force-dynamic'

// ============================================================
// GET /api/cron/hosted-event-proof-reminders
// Runs every 5 minutes (vercel.json: "*/5 * * * *"). Pushes and emails a host
// 20 minutes after their round's tee time, asking for the proof photo that
// earns their credit.
//
// proof_reminder_sent is the idempotency guard (see 20261008000001), so a
// re-run or an overlapping invocation can't remind the same round twice. Like
// booking-surveys there's no ±window: any due, unreminded round is fair game,
// so a skipped run self-heals on the next pass.
//
// Test locally:
//   curl -H "Authorization: Bearer <CRON_SECRET>" \
//     http://localhost:3000/api/cron/hosted-event-proof-reminders
// ============================================================

import { type NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { NotificationTemplates } from '@/lib/push'
import { notifyMember } from '@/lib/notify'
import { isProofReminderDue, PROOF_REMINDABLE_STATUSES } from '@/lib/hosts/proof-reminder'
import { formatBookingDate } from '@/lib/utils'
import { logger } from '@/lib/logger'

// A round further back than this is past the point of a "your round is under
// way" nudge — the flag stays false, but nothing chases it.
const BACKLOG_DAYS = 2

const dayKey = (d: Date) => d.toISOString().slice(0, 10)

interface EventRow {
  id: string
  event_date: string
  tee_time: string | null
  host: { member_id: string } | null
  course: { name: string; timezone: string | null } | null
}

export async function GET(request: NextRequest) {
  // Fail closed when the secret isn't configured — otherwise the comparison
  // would succeed against the literal string "Bearer undefined".
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const admin = createAdminClient()
  const now = new Date()
  const from = dayKey(new Date(now.getTime() - BACKLOG_DAYS * 24 * 60 * 60 * 1000))
  // UTC tomorrow: a venue west of UTC is still on "today" when UTC has rolled over.
  const to = dayKey(new Date(now.getTime() + 24 * 60 * 60 * 1000))

  const { data, error } = await admin
    .from('hosted_events')
    .select('id, event_date, tee_time, host:hosts(member_id), course:courses(name, timezone)')
    .eq('proof_reminder_sent', false)
    .in('status', PROOF_REMINDABLE_STATUSES)
    .gte('event_date', from)
    .lte('event_date', to)

  if (error) {
    logger.error('hosted-event-proof-reminders cron failed to fetch', {
      action: 'cron.hosted_event_proof_reminders',
      metadata: { error: error.message },
    })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const candidates = (data ?? []) as unknown as EventRow[]
  const due = candidates.filter(e => isProofReminderDue(e, e.course?.timezone, now))

  if (due.length === 0) {
    return NextResponse.json({ ok: true, checked: candidates.length, sent: 0 })
  }

  // A host who already uploaded doesn't need asking. Still flag the round.
  const { data: proofs } = await admin
    .from('hosted_event_proofs')
    .select('hosted_event_id')
    .in('hosted_event_id', due.map(e => e.id))
  const proven = new Set((proofs ?? []).map(p => p.hosted_event_id))

  let sent = 0
  let skipped = 0
  let failed = 0
  const flagged: string[] = []

  for (const event of due) {
    if (proven.has(event.id) || !event.host?.member_id) {
      skipped++
      flagged.push(event.id)
      continue
    }

    try {
      // Push and email both — notifyMember fans the one template out to each.
      await notifyMember(
        event.host.member_id,
        NotificationTemplates.hostedEventProofReminder(
          event.course?.name ?? 'your venue',
          formatBookingDate(event.event_date),
          event.id,
        ),
      )
      sent++
      flagged.push(event.id)
    } catch (err) {
      // Leave the flag unset so the next run retries this one.
      failed++
      logger.error('hosted-event-proof-reminders: notify failed', {
        action: 'cron.hosted_event_proof_reminders',
        metadata: { hosted_event_id: event.id },
        errorMessage: err instanceof Error ? err.message : String(err),
      })
    }
  }

  if (flagged.length > 0) {
    const { error: flagError } = await admin
      .from('hosted_events')
      .update({ proof_reminder_sent: true })
      .in('id', flagged)

    // Worst case is a repeat reminder on the next run, so log rather than retry.
    if (flagError) {
      logger.error('hosted-event-proof-reminders: could not flag reminded rounds', {
        action: 'cron.hosted_event_proof_reminders',
        metadata: { count: flagged.length, error: flagError.message },
      })
    }
  }

  logger.info('hosted-event-proof-reminders cron ran', {
    action: 'cron.hosted_event_proof_reminders',
    metadata: { checked: candidates.length, due: due.length, sent, skipped, failed },
  })

  return NextResponse.json({ ok: true, checked: candidates.length, due: due.length, sent, skipped, failed })
}
