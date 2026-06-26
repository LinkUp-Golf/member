export const dynamic = 'force-dynamic'

// ============================================================
// GET /api/cron/booking-reminders
// Runs every minute (vercel.json: "* * * * *").
// Change to a wider schedule (e.g. "*/5 * * * *") in production
// once confirmed working.
//
// For each upcoming non-cancelled booking:
//   • Sends a push notification + notification_log entry at:
//     - 7 days before tee time
//     - 3 days before tee time
//     - 6 hours before tee time
//
// Test locally (CRON_SECRET from .env.local):
//   curl -H "Authorization: Bearer <CRON_SECRET>" \
//        http://localhost:3000/api/cron/booking-reminders
// ============================================================

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { sendPushToMember } from '@/lib/push'
import { bookingToLocalDate } from '@/lib/utils'
import { format, addDays, addHours } from 'date-fns'
import { logger } from '@/lib/logger'

// How far either side of the target time we'll still fire a reminder.
// 5 minutes handles the 1-min cron cadence with generous headroom.
const WINDOW_MS = 5 * 60 * 1000

type ReminderType = '7d' | '3d' | '6h'

interface Reminder {
  type: ReminderType
  flag: 'reminder_7d_sent' | 'reminder_3d_sent' | 'reminder_6h_sent'
  targetFn: (now: Date) => Date
}

const REMINDERS: Reminder[] = [
  { type: '7d', flag: 'reminder_7d_sent', targetFn: (now) => addDays(now,  7) },
  { type: '3d', flag: 'reminder_3d_sent', targetFn: (now) => addDays(now,  3) },
  { type: '6h', flag: 'reminder_6h_sent', targetFn: (now) => addHours(now, 6) },
]

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const now = new Date()
  const admin = createAdminClient()

  // Fetch upcoming bookings for the next 8 days that still have pending reminders.
  // Guest-name rows (non-member guests) have no account — skip them via guest_name IS NULL.
  const windowStart = format(now, 'yyyy-MM-dd')
  const windowEnd   = format(addDays(now, 8), 'yyyy-MM-dd')

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
    .gte('booking_date', windowStart)
    .lte('booking_date', windowEnd)
    .is('guest_name', null)

  if (bookingsError) {
    logger.error('booking-reminders: failed to fetch bookings', {
      action: 'cron.booking_reminders',
      errorMessage: bookingsError.message,
    })
    return NextResponse.json({ error: bookingsError.message }, { status: 500 })
  }

  // Fetch all distinct courses referenced so we can build the notification text.
  const courseIds = [...new Set((bookings ?? []).map(b => b.course_id))]
  const courseMap = new Map<string, { name: string; city: string; state: string }>()
  if (courseIds.length > 0) {
    const { data: courses } = await admin
      .from('courses')
      .select('id, name, city, state')
      .in('id', courseIds)
    courses?.forEach(c => courseMap.set(c.id, c))
  }

  const results = { checked: bookings?.length ?? 0, sent: 0, errors: 0 }

  for (const booking of bookings ?? []) {
    // Determine the member who owns this booking row
    const recipientId: string | null = booking.player_member_id ?? booking.member_id ?? null
    if (!recipientId) continue

    const teeDate = bookingToLocalDate(booking.booking_date, booking.tee_time)
    const course  = courseMap.get(booking.course_id)
    const dateStr = format(teeDate, 'EEEE, MMMM d')
    const timeStr = format(teeDate, 'h:mm a')
    const venue   = course?.name ?? 'the course'
    const address = course ? `${course.city}, ${course.state}` : ''

    for (const reminder of REMINDERS) {
      // Skip if already sent
      if (booking[reminder.flag]) continue

      const target = reminder.targetFn(now)
      const diff   = Math.abs(teeDate.getTime() - target.getTime())
      if (diff > WINDOW_MS) continue

      const title = `Upcoming tee time 🏌️`
      const body  = `You're playing golf at ${venue} on ${dateStr} at ${timeStr}${address ? `. Address: ${address}` : ''}`

      try {
        // Push notification
        await sendPushToMember(recipientId, {
          title,
          body,
          url: '/book',
          tag: `booking-reminder-${booking.id}-${reminder.type}`,
        })

        // In-app notification log
        await admin.from('notification_log').insert({
          member_id: recipientId,
          type:      'booking_reminder',
          title,
          body,
          data:      { booking_id: booking.id, reminder: reminder.type },
          url:       '/book',
        })

        // Mark reminder as sent
        await admin
          .from('bookings')
          .update({ [reminder.flag]: true })
          .eq('id', booking.id)

        results.sent++

        // eslint-disable-next-line no-console
        console.log(`[cron/booking-reminders] sent ${reminder.type} reminder → member ${recipientId} for booking ${booking.id}`)
      } catch (err) {
        results.errors++
        logger.error('booking-reminders: failed to send reminder', {
          action: 'cron.booking_reminders',
          metadata: { booking_id: booking.id, reminder: reminder.type, recipient: recipientId },
          errorMessage: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

  // eslint-disable-next-line no-console
  console.log(`[cron/booking-reminders] done — checked: ${results.checked}, sent: ${results.sent}, errors: ${results.errors}`)
  logger.info('booking-reminders cron complete', {
    action: 'cron.booking_reminders',
    metadata: results,
  })

  return NextResponse.json({ ok: true, ...results })
}
