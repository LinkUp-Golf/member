export const dynamic = 'force-dynamic'

// ============================================================
// POST /api/admin/bookings/[id]/move
//   body { date: 'YYYY-MM-DD', teeTime?: 'HH:mm' }
//
// Moves the booking group this row belongs to — the booker's seat and every
// player they booked with in the same go — to another day, and optionally
// another tee time (the current one if omitted). A group moves whole: moving
// one row would leave a player on a different day from the people they booked
// with.
//
// The new day is held to the same daily cap and curated-slot seats as a new
// booking, atomically (move_booking_group). Then each row's GHL appointment is
// moved to match — best-effort, like every GHL step after the database has
// committed; the response says how many couldn't be. Everyone on the round is
// told.
// ============================================================

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { format } from 'date-fns'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { resolveMeetingDurationMins, rescheduleBooking } from '@/lib/ghl/client'
import { resolveAppointmentIso } from '@/lib/ghl/booking-time'
import { NotificationTemplates } from '@/lib/push'
import { notifyMembers } from '@/lib/notify'
import { validateDate } from '@/lib/validation'
import { formatTeeTime } from '@/lib/utils'
import { logger } from '@/lib/logger'
import {
  AVIARA_TIMEZONE,
  DEFAULT_MAX_PLAYERS_PER_DAY,
  FALLBACK_ROUND_DURATION_MINUTES,
} from '@/lib/constants'
import type { AuthContext } from '@/lib/auth/types'

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export const POST = withAuth(
  async (req: NextRequest, ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing booking id' }, { status: 400 })

    const body = await req.json().catch(() => null) as { date?: unknown; teeTime?: unknown } | null
    const date = typeof body?.date === 'string' ? body.date : ''
    if (!validateDate(date, 'date').valid) {
      return NextResponse.json({ error: 'Pick a date to move the booking to.' }, { status: 400 })
    }
    const teeTimeIn = typeof body?.teeTime === 'string' && body.teeTime ? body.teeTime : null
    if (teeTimeIn && !TIME_RE.test(teeTimeIn)) {
      return NextResponse.json({ error: 'Tee time must be HH:mm.' }, { status: 400 })
    }

    const admin = createAdminClient()

    const { data: row } = await admin
      .from('bookings')
      .select('id, member_id, course_id, booking_date, tee_time, created_at, status')
      .eq('id', id)
      .single()
    if (!row) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })

    const { data: course } = await admin
      .from('courses')
      .select('id, name, timezone, ghl_calendar_id, meeting_duration_mins, max_players_per_day')
      .eq('id', row.course_id)
      .single()
    if (!course) return NextResponse.json({ error: 'Course not found' }, { status: 404 })

    const timezone = course.timezone || AVIARA_TIMEZONE
    // A round can only move into the future — "today" at the venue counts.
    const todayAtVenue = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date())
    if (date < todayAtVenue) {
      return NextResponse.json({ error: "A booking can't be moved to a day that has passed." }, { status: 400 })
    }

    // 'HH:MM:SS', the shape the column holds.
    const teeTime = teeTimeIn ? `${teeTimeIn}:00` : String(row.tee_time)
    if (date === row.booking_date && teeTime === String(row.tee_time)) {
      return NextResponse.json({ error: 'That is the date and time it is already on.' }, { status: 400 })
    }

    // The group: every row the booker made in the same statement for this slot.
    const { data: group } = await admin
      .from('bookings')
      .select('id')
      .eq('member_id', row.member_id)
      .eq('created_at', row.created_at)
      .eq('booking_date', row.booking_date)
      .eq('tee_time', row.tee_time)
    const ids = (group ?? []).map(g => g.id as string)
    if (ids.length === 0) ids.push(row.id)

    const { data: moved, error: moveError } = await admin.rpc('move_booking_group', {
      p_ids: ids,
      p_course_id: row.course_id,
      p_date: date,
      p_tee_time: teeTime,
      p_capacity: course.max_players_per_day ?? DEFAULT_MAX_PLAYERS_PER_DAY,
    })

    if (moveError) {
      const dayFull = /DAY_FULL:(\d+)/.exec(moveError.message ?? '')
      if (dayFull) {
        const left = parseInt(dayFull[1] ?? '0', 10)
        return NextResponse.json(
          { error: left > 0 ? `Only ${left} spot${left === 1 ? '' : 's'} left on that day — not enough for this group.` : 'That day is fully booked.' },
          { status: 409 },
        )
      }
      const slotFull = /SLOT_FULL:(\d{2}:\d{2}):(\d+)/.exec(moveError.message ?? '')
      if (slotFull) {
        const left = parseInt(slotFull[2] ?? '0', 10)
        return NextResponse.json(
          { error: left > 0 ? `Only ${left} spot${left === 1 ? '' : 's'} left at that tee time — not enough for this group.` : 'That tee time is full.' },
          { status: 409 },
        )
      }
      logger.error('Admin booking move failed', { action: 'booking.moved', errorMessage: moveError.message })
      return NextResponse.json({ error: 'Failed to move the booking.' }, { status: 500 })
    }

    type MovedRow = { id: string; member_id: string; player_member_id: string | null; ghl_booking_id: string | null; status: string }
    const movedRows = (moved ?? []) as MovedRow[]

    // Move each GHL appointment to match. The database is already right, so a
    // failure here is reported rather than undone.
    let ghlFailed = 0
    const withAppointment = movedRows.filter(r => r.ghl_booking_id && r.status !== 'cancelled')
    if (withAppointment.length > 0 && course.ghl_calendar_id) {
      const duration = await resolveMeetingDurationMins(
        course.ghl_calendar_id,
        course.meeting_duration_mins || FALLBACK_ROUND_DURATION_MINUTES,
      )
      const { startIso, endIso } = resolveAppointmentIso(date, teeTime, timezone, duration)
      const results = await Promise.all(withAppointment.map(r =>
        rescheduleBooking(r.ghl_booking_id as string, { startTime: startIso, endTime: endIso, timezone }),
      ))
      ghlFailed = results.filter(ok => !ok).length
    }

    // Everyone still on the round hears about it: the booker, and each player
    // with an account (a member, or a non-member guest once provisioned).
    const recipients = [
      row.member_id as string,
      ...movedRows
        .filter(r => r.status !== 'cancelled' && r.player_member_id)
        .map(r => r.player_member_id as string),
    ]
    void notifyMembers(
      recipients,
      NotificationTemplates.bookingMoved(
        course.name,
        format(new Date(`${date}T12:00:00`), 'EEEE, MMMM d'),
        formatTeeTime(teeTime),
      ),
    ).catch(() => {})

    logger.info('Admin moved booking', {
      action: 'booking.moved',
      userId: ctx.userId,
      metadata: { booking_id: id, rows: ids.length, from: `${row.booking_date} ${row.tee_time}`, to: `${date} ${teeTime}`, ghlFailed },
    })
    try {
      await admin.from('admin_audit_log').insert({
        admin_id: ctx.userId,
        action: 'booking.moved',
        target_type: 'booking',
        target_id: id,
        payload: { ids, from: { date: row.booking_date, tee_time: row.tee_time }, to: { date, tee_time: teeTime }, ghlFailed },
      })
    } catch { /* table may not exist yet */ }

    return NextResponse.json({ moved: movedRows.length, date, teeTime, ghlFailed })
  },
  { requireAdmin: true, skipGHLCheck: true },
)
