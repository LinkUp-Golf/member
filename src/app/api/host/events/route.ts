export const dynamic = 'force-dynamic'

// GET  /api/host/events — the caller's own hosted events, with spot counts.
// POST /api/host/events — create a hosted event (draft, or published live).

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withHostAuth, type HostAuthContext } from '@/lib/auth/with-host-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { validateHostedEventPayload, sanitiseText } from '@/lib/validation'
import { enrichHostedEvents } from '@/lib/hosts/events'
import { logger } from '@/lib/logger'
import type { HostedEvent } from '@/types'

const todayISO = () => new Date().toISOString().slice(0, 10)

export const GET = withHostAuth(async (_req: NextRequest, ctx: HostAuthContext) => {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('hosted_events')
    .select('*, course:courses(id, name)')
    .eq('host_id', ctx.host.id)
    .order('event_date', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const events = await enrichHostedEvents(admin, (data ?? []) as HostedEvent[])
  return NextResponse.json({ events })
})

// Cancelled / waitlisted rows don't hold a seat — same rule as the capacity RPCs.
const ACTIVE_BOOKING_STATUSES = [
  'tentative', 'awaiting_approval', 'availability_confirmed',
  'payment_confirmed', 'confirmed', 'pending',
]

export const POST = withHostAuth(async (req: NextRequest, ctx: HostAuthContext) => {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>

  const admin = createAdminClient()
  const sourceBookingId = typeof body.source_booking_id === 'string' && body.source_booking_id
    ? body.source_booking_id
    : null

  let courseId: string
  let eventDate: string
  let teeTime: string | null
  let seatCap: number | null = null

  if (sourceBookingId) {
    // ---- Listed from an existing booking -------------------------------
    // Any active booking may be taken on by a host, not just their own.
    // Course/date/tee time come from the booking, never from the client, so the
    // event can't drift from the real tee time.
    const { data: booking } = await admin
      .from('bookings')
      .select('id, member_id, course_id, booking_date, tee_time, created_at, status')
      .eq('id', sourceBookingId)
      .maybeSingle()

    if (!booking) {
      return NextResponse.json({ error: 'That booking no longer exists.' }, { status: 404 })
    }
    if (!ACTIVE_BOOKING_STATUSES.includes(booking.status)) {
      return NextResponse.json({ error: 'That booking is no longer active.' }, { status: 400 })
    }
    if (booking.booking_date < todayISO()) {
      return NextResponse.json({ error: 'That booking has already passed.' }, { status: 400 })
    }

    courseId = booking.course_id
    eventDate = booking.booking_date
    teeTime = String(booking.tee_time).slice(0, 5)

    // Seats held = rows in the same booking group (one row per seat), counted
    // against whoever made the booking.
    const { count } = await admin
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('member_id', booking.member_id)
      .eq('created_at', booking.created_at)
      .eq('booking_date', booking.booking_date)
      .eq('tee_time', booking.tee_time)
      .eq('course_id', booking.course_id)
      .in('status', ACTIVE_BOOKING_STATUSES)
    seatCap = count ?? 1

    if (Number(body.total_spots) > seatCap) {
      return NextResponse.json(
        { error: `That booking holds ${seatCap} seat${seatCap === 1 ? '' : 's'} — you can't offer more than that.` },
        { status: 400 }
      )
    }
  } else {
    // ---- A newly proposed schedule -------------------------------------
    const { valid, errors } = validateHostedEventPayload(body)
    if (!valid) return NextResponse.json({ error: errors[0] }, { status: 400 })

    eventDate = String(body.event_date)
    if (eventDate < todayISO()) {
      return NextResponse.json({ error: 'Event date cannot be in the past.' }, { status: 400 })
    }
    courseId = String(body.course_id)
    // Free text the host typed — sanitise like any other free-form field.
    teeTime = typeof body.tee_time === 'string' && body.tee_time.trim()
      ? sanitiseText(body.tee_time.trim())
      : null
  }

  // Spots/rate are validated in both paths.
  const spots = Number(body.total_spots)
  const rate = Number(body.member_guest_rate)
  if (!Number.isInteger(spots) || spots < 1 || spots > 200) {
    return NextResponse.json({ error: 'Available spots must be a whole number between 1 and 200' }, { status: 400 })
  }
  if (!Number.isFinite(rate) || rate < 0 || rate > 100000) {
    return NextResponse.json({ error: 'Member guest rate must be a positive amount' }, { status: 400 })
  }

  // The course must exist and be bookable.
  const { data: course } = await admin
    .from('courses')
    .select('id, name, approval_status')
    .eq('id', courseId)
    .maybeSingle()
  if (!course || course.approval_status !== 'active') {
    return NextResponse.json({ error: 'That course is not available for events.' }, { status: 400 })
  }

  // Publishing takes an event straight live — there's no admin review gate.
  // A host either saves a draft or publishes to 'upcoming' immediately.
  const publish = body.publish === true
  const dinner = body.dinner === true

  const { data: event, error } = await admin
    .from('hosted_events')
    .insert({
      host_id: ctx.host.id,
      course_id: course.id,
      event_date: eventDate,
      tee_time: teeTime,
      total_spots: spots,
      member_guest_rate: rate,
      dinner,
      source_booking_id: sourceBookingId,
      status: publish ? 'upcoming' : 'draft',
    })
    .select()
    .single()

  if (error) {
    // The partial unique index on source_booking_id — this booking is already
    // listed as a live event.
    if (error.code === '23505') {
      return NextResponse.json({ error: 'That booking is already listed as an event.' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  logger.info('Hosted event created', {
    action: 'host.event.created',
    userId: ctx.userId,
    metadata: { event_id: event.id, host_id: ctx.host.id, published: publish, from_booking: !!sourceBookingId },
  })

  return NextResponse.json({ event }, { status: 201 })
})
