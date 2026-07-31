export const dynamic = 'force-dynamic'

// ============================================================
// GET /api/cron/booking-surveys
// Runs every 15 minutes (vercel.json: "*/15 * * * *"). Sends the "how was your
// round?" push once a booking's round has finished.
//
// This is what makes the survey reach a member whose app is closed. With the
// app open, useBookingSurvey already opens the prompt on its own timer at the
// same instant; this covers everyone else, and tapping the notification opens
// the app onto a prompt that is by then due.
//
// The survey_prompt_sent flag is the idempotency guard, so a re-run or an
// overlapping invocation can't nudge the same round twice. There's no ±window
// like booking-reminders uses: any finished, unprompted round is fair game, so
// a failed or skipped run self-heals on the next pass instead of losing the
// notification entirely.
//
// Test locally:
//   curl -H "Authorization: Bearer <CRON_SECRET>" \
//     http://localhost:3000/api/cron/booking-surveys
// ============================================================

import { type NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { sendPushToMember, NotificationTemplates } from '@/lib/push'
import { isSurveyDue, surveyRecipientId, SURVEYABLE_BOOKING_STATUSES } from '@/lib/surveys/due'
import { logger } from '@/lib/logger'

// Matches the in-app backlog window: past this, the round is too stale to be
// worth a notification.
const BACKLOG_DAYS = 14

const dayKey = (d: Date) => d.toISOString().slice(0, 10)

interface BookingRow {
  id: string
  booking_date: string
  tee_time: string
  member_id: string
  player_member_id: string | null
  course_id: string
  course: {
    name: string
    timezone: string | null
    meeting_duration_mins: number | null
  } | null
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
  const to = dayKey(now)

  const { data, error } = await admin
    .from('bookings')
    .select(
      'id, booking_date, tee_time, member_id, player_member_id, course_id, course:courses!bookings_course_id_fkey(name, timezone, meeting_duration_mins)',
    )
    .eq('survey_prompt_sent', false)
    // Rounds that predate the survey aren't chased — see the migration.
    .eq('survey_auto_prompt', true)
    // 'cancelled' isn't in this list, so a cancelled round is never surveyed.
    .in('status', SURVEYABLE_BOOKING_STATUSES)
    .gte('booking_date', from)
    .lte('booking_date', to)

  if (error) {
    logger.error('booking-surveys cron failed to fetch', {
      action: 'cron.booking_surveys',
      metadata: { error: error.message },
    })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const candidates = (data ?? []) as unknown as BookingRow[]
  // A round is only askable once it has actually finished in the course's own
  // timezone — the date filter above is a coarse prefilter.
  const due = candidates.filter(b => isSurveyDue(b, b.course, now))

  if (due.length === 0) {
    return NextResponse.json({ ok: true, checked: candidates.length, sent: 0 })
  }

  // A member who already answered in-app doesn't need the nudge. Still flag
  // those bookings, so they drop out of every later run.
  const { data: answered } = await admin
    .from('booking_surveys')
    .select('booking_id')
    .in('booking_id', due.map(b => b.id))

  const answeredIds = new Set((answered ?? []).map(r => r.booking_id))

  let sent = 0
  let skipped = 0
  let failed = 0
  const flagged: string[] = []

  for (const booking of due) {
    if (answeredIds.has(booking.id)) {
      skipped++
      flagged.push(booking.id)
      continue
    }

    try {
      await sendPushToMember(
        surveyRecipientId(booking),
        NotificationTemplates.roundSurvey(booking.course?.name ?? 'your round', booking.id),
      )
      sent++
      flagged.push(booking.id)
    } catch (err) {
      // Leave the flag unset so the next run retries this one. A member with no
      // push subscription isn't a failure — sendPushToMember resolves with
      // sent: 0 and still writes the in-app notification log entry.
      failed++
      logger.error('booking-surveys: push failed', {
        action: 'cron.booking_surveys',
        metadata: { booking_id: booking.id },
        errorMessage: err instanceof Error ? err.message : String(err),
      })
    }
  }

  if (flagged.length > 0) {
    const { error: flagError } = await admin
      .from('bookings')
      .update({ survey_prompt_sent: true })
      .in('id', flagged)

    // Worst case here is a repeat notification on the next run, which is why
    // it's logged rather than retried.
    if (flagError) {
      logger.error('booking-surveys: could not flag prompted bookings', {
        action: 'cron.booking_surveys',
        metadata: { count: flagged.length, error: flagError.message },
      })
    }
  }

  logger.info('booking-surveys cron ran', {
    action: 'cron.booking_surveys',
    metadata: { checked: candidates.length, due: due.length, sent, skipped, failed },
  })

  return NextResponse.json({ ok: true, checked: candidates.length, due: due.length, sent, skipped, failed })
}
