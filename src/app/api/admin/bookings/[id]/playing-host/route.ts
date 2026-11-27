export const dynamic = 'force-dynamic'

// ============================================================
// POST /api/admin/bookings/[id]/playing-host
//   body { memberId: uuid }
//
// Hands the playing host's seat (see @/lib/bookings/playing-host) to another
// member — an alternate host taking the first foursome on a day Greg isn't
// playing. The seat stays what it is: free, in the same tee time, still the
// host's seat, so the next booking that day doesn't add Greg back. Only the
// person on it changes.
//
// Removing the host without a replacement is the row's ordinary Delete: the day
// is already decided, so nobody is added back either.
//
// The new member's GHL appointment is made first; if GHL refuses, nothing has
// changed. The old appointment is removed after, best-effort.
// ============================================================

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { format } from 'date-fns'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { createBooking, deleteBooking, resolveMeetingDurationMins } from '@/lib/ghl/client'
import { resolveAppointmentIso } from '@/lib/ghl/booking-time'
import { NotificationTemplates } from '@/lib/push'
import { notifyMember } from '@/lib/notify'
import { validateUUID } from '@/lib/validation'
import { formatTeeTime, titleCaseName } from '@/lib/utils'
import { logger } from '@/lib/logger'
import { AVIARA_ADDRESS, AVIARA_TIMEZONE, FALLBACK_ROUND_DURATION_MINUTES } from '@/lib/constants'
import type { AuthContext } from '@/lib/auth/types'

export const POST = withAuth(
  async (req: NextRequest, ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing booking id' }, { status: 400 })

    const body = await req.json().catch(() => null) as { memberId?: unknown } | null
    const memberId = typeof body?.memberId === 'string' ? body.memberId : ''
    if (!validateUUID(memberId, 'member id').valid) {
      return NextResponse.json({ error: 'Pick a member.' }, { status: 400 })
    }

    const admin = createAdminClient()

    const { data: seat } = await admin
      .from('bookings')
      .select('id, member_id, course_id, booking_date, tee_time, status, ghl_booking_id, playing_host')
      .eq('id', id)
      .single()
    if (!seat) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
    if (!seat.playing_host) {
      return NextResponse.json({ error: "Only the host's seat can be handed to someone else." }, { status: 400 })
    }
    if (seat.member_id === memberId) {
      return NextResponse.json({ error: 'They are already on this seat.' }, { status: 400 })
    }

    const { data: member } = await admin
      .from('members')
      .select('id, first_name, last_name, email, phone, ghl_contact_id')
      .eq('id', memberId)
      .single()
    if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    if (!member.ghl_contact_id) {
      return NextResponse.json({ error: "That member isn't set up in GHL yet, so they can't be booked." }, { status: 422 })
    }

    // Nobody plays the same day twice at one venue.
    const { count: alreadyOn } = await admin
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('course_id', seat.course_id)
      .eq('booking_date', seat.booking_date)
      .not('status', 'in', '(cancelled,waitlist)')
      .or(`player_member_id.eq.${memberId},and(member_id.eq.${memberId},guest_name.is.null,player_member_id.is.null)`)
    if (alreadyOn) {
      return NextResponse.json({ error: 'That member is already playing at this venue that day.' }, { status: 409 })
    }

    const { data: course } = await admin
      .from('courses')
      .select('name, ghl_calendar_id, timezone, address, city, meeting_duration_mins')
      .eq('id', seat.course_id)
      .single()
    if (!course?.ghl_calendar_id) {
      return NextResponse.json({ error: "This venue's calendar isn't set up." }, { status: 422 })
    }

    const timezone = course.timezone || AVIARA_TIMEZONE
    const teeTime = String(seat.tee_time)
    const duration = await resolveMeetingDurationMins(
      course.ghl_calendar_id,
      course.meeting_duration_mins || FALLBACK_ROUND_DURATION_MINUTES,
    )
    const { startIso, endIso } = resolveAppointmentIso(seat.booking_date, teeTime, timezone, duration)

    let ghlId: string
    try {
      ghlId = await createBooking({
        calendarId: course.ghl_calendar_id,
        title: `LinkUp @ ${course.name}`,
        startTime: startIso,
        endTime: endIso,
        timezone,
        address: course.address || course.city || AVIARA_ADDRESS,
        contact: { id: member.ghl_contact_id, email: member.email, phone: member.phone ?? null },
      })
    } catch (err) {
      logger.warn('Playing host replacement: GHL appointment failed', {
        action: 'playing_host.replace_ghl_failed',
        errorMessage: String(err),
        metadata: { bookingId: id, memberId },
      })
      return NextResponse.json({ error: "GHL wouldn't take the appointment, so nothing was changed. Please try again." }, { status: 502 })
    }

    const { error: updateError } = await admin
      .from('bookings')
      .update({ member_id: memberId, ghl_booking_id: ghlId })
      .eq('id', id)
    if (updateError) {
      void deleteBooking(ghlId)
      logger.error('Playing host replacement failed', { action: 'playing_host.replaced', errorMessage: updateError.message })
      return NextResponse.json({ error: 'Failed to replace the host.' }, { status: 500 })
    }

    const oldGhlDeleted = seat.ghl_booking_id ? await deleteBooking(seat.ghl_booking_id) : true

    void notifyMember(
      memberId,
      NotificationTemplates.bookingMadeForYou(
        course.name,
        format(new Date(`${seat.booking_date}T12:00:00`), 'EEEE, MMMM d'),
        formatTeeTime(teeTime),
      ),
    ).catch(() => {})

    logger.info('Admin replaced the playing host', {
      action: 'playing_host.replaced',
      userId: ctx.userId,
      metadata: { booking_id: id, from: seat.member_id, to: memberId, oldGhlDeleted },
    })
    try {
      await admin.from('admin_audit_log').insert({
        admin_id: ctx.userId,
        action: 'playing_host.replaced',
        target_type: 'booking',
        target_id: id,
        payload: { from: seat.member_id, to: memberId, old_ghl_booking_id: seat.ghl_booking_id, oldGhlDeleted },
      })
    } catch { /* table may not exist yet */ }

    const name = titleCaseName(`${member.first_name ?? ''} ${member.last_name ?? ''}`.trim()) || member.email
    return NextResponse.json({
      ok: true,
      message: oldGhlDeleted
        ? `${name} now has the host's seat and has been notified.`
        : `${name} now has the host's seat, but the old GHL appointment couldn't be removed — delete it in GHL.`,
    })
  },
  { requireAdmin: true, skipGHLCheck: true },
)
