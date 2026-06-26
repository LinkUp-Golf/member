export const dynamic = 'force-dynamic'

// ============================================================
// GET /api/cron/booking-reminders
// Runs every 15 minutes (vercel.json: "*/15 * * * *").
//
// For each upcoming non-cancelled booking, reminders fire at:
//   • teeTime - 7 days   (7-day reminder)
//   • teeTime - 3 days   (3-day reminder)
//   • teeTime - 6 hours  (6-hour reminder)
//
// The cron runs every 15 minutes; any booking whose reminder
// target falls within ±8 minutes of now will be triggered.
// This means each member's reminder arrives within ~8 minutes
// of their booking's actual 7-day / 3-day / 6-hour mark.
//
// The reminder_*_sent flags prevent duplicate sends even if
// the cron overlaps a boundary.
//
// Test locally:
//   curl -H "Authorization: Bearer <CRON_SECRET>" \
//        http://localhost:3000/api/cron/booking-reminders
// ============================================================

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { sendPushToMember } from '@/lib/push'
import { bookingToLocalDate } from '@/lib/utils'
import { format, subDays, subHours, addDays } from 'date-fns'
import { logger } from '@/lib/logger'

// Half the cron cadence + small buffer. Cron runs every 15 min → ±8 min window.
// Any booking whose reminder target is within 8 min of now will fire.
const WINDOW_MS = 8 * 60 * 1000

type ReminderType = '7d' | '3d' | '6h'

interface Reminder {
  type:     ReminderType
  flag:     'reminder_7d_sent' | 'reminder_3d_sent' | 'reminder_6h_sent'
  // Returns the exact UTC moment this reminder should fire for a given tee time
  targetFn: (teeTime: Date) => Date
  label:    string
}

const REMINDERS: Reminder[] = [
  {
    type:     '7d',
    flag:     'reminder_7d_sent',
    targetFn: (tee) => subDays(tee, 7),
    label:    'in 7 days',
  },
  {
    type:     '3d',
    flag:     'reminder_3d_sent',
    targetFn: (tee) => subDays(tee, 3),
    label:    'in 3 days',
  },
  {
    type:     '6h',
    flag:     'reminder_6h_sent',
    targetFn: (tee) => subHours(tee, 6),
    label:    'in 6 hours',
  },
]

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const now   = new Date()
  const admin = createAdminClient()

  // Fetch upcoming bookings in the relevant window.
  // We need bookings up to 7 days + 8 min ahead (furthest reminder target)
  // and from 6 hours - 8 min ago (nearest target for the 6h reminder).
  const fetchFrom = format(subHours(now, 1),    'yyyy-MM-dd')
  const fetchTo   = format(addDays(now, 8),     'yyyy-MM-dd')

  const { data: bookings, error: bookingsError } = await admin
    .from('bookings')
    .select(`
      id,
      booking_date,
      tee_time,
      member_id,
      player_member_id,
      guest_name,
      course_id,
      status,
      reminder_7d_sent,
      reminder_3d_sent,
      reminder_6h_sent
    `)
    .not('status', 'in', '("cancelled","waitlist")')
    .gte('booking_date', fetchFrom)
    .lte('booking_date', fetchTo)
    .is('guest_name', null)

  if (bookingsError) {
    logger.error('booking-reminders: failed to fetch bookings', {
      action: 'cron.booking_reminders',
      errorMessage: bookingsError.message,
    })
    return NextResponse.json({ error: bookingsError.message }, { status: 500 })
  }

  // Fetch course names
  const courseIds = [...new Set((bookings ?? []).map(b => b.course_id))]
  const courseMap = new Map<string, { name: string; city: string }>()
  if (courseIds.length > 0) {
    const { data: courses } = await admin
      .from('courses')
      .select('id, name, city')
      .in('id', courseIds)
    courses?.forEach(c => courseMap.set(c.id, c))
  }

  const results = { checked: bookings?.length ?? 0, sent: 0, errors: 0 }

  for (const booking of bookings ?? []) {
    const recipientId: string | null = booking.player_member_id ?? booking.member_id ?? null
    if (!recipientId) continue

    const teeDate = bookingToLocalDate(booking.booking_date, booking.tee_time)
    const course  = courseMap.get(booking.course_id)
    const dateStr = format(teeDate, 'EEEE, MMMM d')
    const timeStr = format(teeDate, 'h:mm a')
    const venue   = course?.name ?? 'the course'

    for (const reminder of REMINDERS) {
      // Skip if already sent
      if (booking[reminder.flag]) continue

      // Compute the exact moment this reminder should fire
      const reminderAt = reminder.targetFn(teeDate)
      const diff = Math.abs(now.getTime() - reminderAt.getTime())
      if (diff > WINDOW_MS) continue

      const title = `Tee time ${reminder.label} 🏌️`
      const body  = `You're playing at ${venue} on ${dateStr} at ${timeStr}`

      try {
        await sendPushToMember(recipientId, {
          title,
          body,
          url: '/book',
          tag: `booking-reminder-${booking.id}-${reminder.type}`,
        })

        await admin.from('notification_log').insert({
          member_id: recipientId,
          type:      'booking_reminder',
          title,
          body,
          data:      { booking_id: booking.id, reminder: reminder.type },
          url:       '/book',
        })

        await admin
          .from('bookings')
          .update({ [reminder.flag]: true })
          .eq('id', booking.id)

        results.sent++
        console.log(`[cron/booking-reminders] sent ${reminder.type} → member ${recipientId} booking ${booking.id}`)
      } catch (err) {
        results.errors++
        logger.error('booking-reminders: failed to send', {
          action: 'cron.booking_reminders',
          metadata: { booking_id: booking.id, reminder: reminder.type, recipient: recipientId },
          errorMessage: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

  console.log(`[cron/booking-reminders] done — checked: ${results.checked}, sent: ${results.sent}, errors: ${results.errors}`)
  logger.info('booking-reminders cron complete', {
    action: 'cron.booking_reminders',
    metadata: results,
  })

  return NextResponse.json({ ok: true, ...results })
}
