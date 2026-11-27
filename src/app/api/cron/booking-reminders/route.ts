export const dynamic = 'force-dynamic'

// ============================================================
// GET /api/cron/booking-reminders
// Runs every 15 minutes (vercel.json: "*/15 * * * *").
//
// Reminds every member playing a round: 7 days and 3 days before the tee
// time, and at 8 PM the night before. Covers booked tee times and hosted
// rounds alike. When each one goes out, and its wording, are
// src/lib/bookings/reminders.ts — read that before changing the timing.
//
// Push and email, both from the app (notifyMember). The email and text used
// to come from a GHL workflow the app triggered by webhook; the client
// dropped the text and moved the email to the app (2026-11-27), so that
// webhook is no longer called.
//
// Who is reminded on a booking: whoever the row seats (playingMemberId) —
// the booker, each member they added, and a non-member guest once they're
// linked to their account. It used to read only rows with no guest_name, so
// nobody invited onto someone else's booking was ever reminded.
//
// The reminder_*_sent flags stop a second send.
//
// Test locally:
//   curl -H "Authorization: Bearer <CRON_SECRET>" \
//        http://localhost:3000/api/cron/booking-reminders
// ============================================================

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { format, addDays, subDays } from 'date-fns'
import { createAdminClient } from '@/lib/supabase-server'
import { notifyMember } from '@/lib/notify'
import { playingMemberId } from '@/lib/bookings/players'
import {
  dueReminders,
  REMINDER_FLAGS,
  reminderBody,
  reminderSubject,
  reminderTitle,
  type ReminderKind,
} from '@/lib/bookings/reminders'
import { formatTeeTime } from '@/lib/utils'
import { AVIARA_TIMEZONE, MY_BOOKINGS_PATH } from '@/lib/constants'
import { logger } from '@/lib/logger'

type Flags = Record<'reminder_7d_sent' | 'reminder_3d_sent' | 'reminder_evening_sent', boolean | null>

function sentFlags(row: Flags): Partial<Record<ReminderKind, boolean>> {
  return {
    '7d': !!row.reminder_7d_sent,
    '3d': !!row.reminder_3d_sent,
    evening: !!row.reminder_evening_sent,
  }
}

/** One round to remind one member about. */
interface Round {
  table: 'bookings' | 'hosted_event_registrations'
  rowId: string
  memberId: string
  courseId: string
  date: string
  teeTime: string
  sent: Partial<Record<ReminderKind, boolean>>
  url: string
}

const FLAG_COLUMNS = 'reminder_7d_sent, reminder_3d_sent, reminder_evening_sent'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const now = new Date()
  const admin = createAdminClient()

  // Every round whose furthest reminder (7 days) or nearest (the night before)
  // could fall on this run. A day either side covers any venue's timezone.
  const fetchFrom = format(subDays(now, 1), 'yyyy-MM-dd')
  const fetchTo = format(addDays(now, 8), 'yyyy-MM-dd')

  const rounds: Round[] = []

  // ---- Booked tee times --------------------------------------
  const { data: bookings, error: bookingsError } = await admin
    .from('bookings')
    .select(`id, booking_date, tee_time, member_id, player_member_id, guest_name, course_id, ${FLAG_COLUMNS}`)
    .not('status', 'in', '("cancelled","waitlist")')
    .gte('booking_date', fetchFrom)
    .lte('booking_date', fetchTo)

  if (bookingsError) {
    logger.error('booking-reminders: failed to fetch bookings', {
      action: 'cron.booking_reminders',
      errorMessage: bookingsError.message,
    })
    return NextResponse.json({ error: bookingsError.message }, { status: 500 })
  }

  for (const b of bookings ?? []) {
    const memberId = playingMemberId(b)
    if (!memberId || !b.tee_time) continue
    rounds.push({
      table: 'bookings',
      rowId: b.id,
      memberId,
      courseId: b.course_id,
      date: b.booking_date,
      teeTime: b.tee_time,
      sent: sentFlags(b as unknown as Flags),
      url: MY_BOOKINGS_PATH,
    })
  }

  // ---- Hosted rounds -----------------------------------------
  // Only a published round with a tee time: there is nothing to count back
  // from without one.
  const { data: events, error: eventsError } = await admin
    .from('hosted_events')
    .select('id, course_id, event_date, tee_time')
    .eq('status', 'upcoming')
    .not('tee_time', 'is', null)
    .gte('event_date', fetchFrom)
    .lte('event_date', fetchTo)

  if (eventsError) {
    // The bookings above still get their reminders.
    logger.error('booking-reminders: failed to fetch hosted rounds', {
      action: 'cron.booking_reminders',
      errorMessage: eventsError.message,
    })
  }

  const eventById = new Map((events ?? []).map(e => [e.id as string, e]))
  if (eventById.size > 0) {
    const { data: registrations, error: regError } = await admin
      .from('hosted_event_registrations')
      .select(`id, hosted_event_id, member_id, ${FLAG_COLUMNS}`)
      .eq('status', 'reserved')
      .in('hosted_event_id', [...eventById.keys()])

    if (regError) {
      logger.error('booking-reminders: failed to fetch hosted-round reservations', {
        action: 'cron.booking_reminders',
        errorMessage: regError.message,
      })
    }

    for (const r of registrations ?? []) {
      const event = eventById.get(r.hosted_event_id)
      if (!event?.tee_time) continue
      rounds.push({
        table: 'hosted_event_registrations',
        rowId: r.id,
        memberId: r.member_id,
        courseId: event.course_id,
        date: event.event_date,
        teeTime: event.tee_time,
        sent: sentFlags(r as unknown as Flags),
        // Where hosted rounds are listed — the same place their other
        // notifications open.
        url: '/book',
      })
    }
  }

  // ---- Venues ------------------------------------------------
  const courseIds = [...new Set(rounds.map(r => r.courseId))]
  const courseMap = new Map<string, { name: string; timezone: string | null }>()
  if (courseIds.length > 0) {
    const { data: courses } = await admin
      .from('courses')
      .select('id, name, timezone')
      .in('id', courseIds)
    courses?.forEach(c => courseMap.set(c.id, c))
  }

  const results = { checked: rounds.length, sent: 0, errors: 0 }

  for (const round of rounds) {
    const course = courseMap.get(round.courseId)
    const timezone = course?.timezone || AVIARA_TIMEZONE
    const due = dueReminders(round.date, round.teeTime, timezone, round.sent, now)
    if (due.length === 0) continue

    // Read off the stored venue-local date and time, never off a Date object:
    // formatted on the server, a Date prints in UTC, which put every reminder's
    // tee time hours out.
    const venue = course?.name ?? 'the course'
    const dateStr = format(new Date(`${round.date.slice(0, 10)}T12:00:00`), 'EEEE, MMMM d')
    const timeStr = formatTeeTime(round.teeTime)

    // When a cron run finds two due at once, one message says it.
    const kind = due[due.length - 1] as ReminderKind

    try {
      await notifyMember(round.memberId, {
        title: reminderTitle(kind),
        body: reminderBody(venue, dateStr, timeStr),
        url: round.url,
        tag: `booking-reminder-${round.rowId}-${kind}`,
        subject: reminderSubject(kind, venue, dateStr, timeStr),
        cta: 'View my round',
      })

      const update = Object.fromEntries(due.map(k => [REMINDER_FLAGS[k], true]))
      await admin.from(round.table).update(update).eq('id', round.rowId)

      results.sent++
      console.log(`[cron/booking-reminders] sent ${kind} → member ${round.memberId} ${round.table} ${round.rowId}`)
    } catch (err) {
      results.errors++
      logger.error('booking-reminders: failed to send', {
        action: 'cron.booking_reminders',
        metadata: { table: round.table, row_id: round.rowId, reminder: kind, recipient: round.memberId },
        errorMessage: err instanceof Error ? err.message : String(err),
      })
    }
  }

  console.log(`[cron/booking-reminders] done — checked: ${results.checked}, sent: ${results.sent}, errors: ${results.errors}`)
  logger.info('booking-reminders cron complete', {
    action: 'cron.booking_reminders',
    metadata: results,
  })

  return NextResponse.json({ ok: true, ...results })
}
