export const dynamic = 'force-dynamic'

// GET  /api/host/events — the caller's own hosted events, with spot counts.
// POST /api/host/events — create a hosted event. It goes live immediately.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withHostAuth, type HostAuthContext } from '@/lib/auth/with-host-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { validateHostedEventPayload, validateProposedClub, normaliseEventDates, sanitiseText } from '@/lib/validation'
import { enrichHostedEvents, hostCanUseCourse } from '@/lib/hosts/events'
import { requestPendingCourse } from '@/lib/courses/request-course'
import { sendPushToAdmins, NotificationTemplates } from '@/lib/push'
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

  // A "new club" event: the host proposes a round at a club not yet on LinkUp.
  // The club is filed as a pending course for an admin to set up properly, but
  // the event itself lists straight away like any other — the round is real,
  // it's only our directory entry for the club that's incomplete.
  const newClubRaw = body.new_club
  const newClub = !sourceBookingId && newClubRaw && typeof newClubRaw === 'object'
    ? (newClubRaw as { name?: unknown; website?: unknown })
    : null

  let courseId: string
  let courseName = 'a course'
  // One event per date. A booking-sourced event is always exactly one (the tee
  // time it came from); the other two paths accept several dates sharing the same
  // course, spots, rate and dinner.
  let eventDates: string[]
  let teeTime: string | null
  let seatCap: number | null = null

  /**
   * The dates asked for, rejecting any that have already passed. Shared by both
   * client-supplied paths so a multi-date submission can't slip a past date
   * through on a later entry.
   */
  const resolveDates = (): { dates?: string[]; error?: string } => {
    const dates = normaliseEventDates(body)
    if (!dates || dates.length === 0) return { error: 'Choose at least one date.' }
    if (dates.some(d => d < todayISO())) {
      return { error: 'Event date cannot be in the past.' }
    }
    return { dates }
  }

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
    // Exactly one: the partial unique index on source_booking_id allows a single
    // live listing per booking, so multiple dates make no sense on this path.
    eventDates = [booking.booking_date]
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
  } else if (newClub) {
    // ---- Proposed at a brand-new club ----------------------------------
    // Everything but the course is validated; the course is created here.
    const { valid, errors } = validateHostedEventPayload(body, { requireCourse: false })
    if (!valid) return NextResponse.json({ error: errors[0] }, { status: 400 })

    // Shared with POST /api/courses/request and the host application form, so the
    // same club proposed from any of the three produces the same row. The website
    // is required on this path only: an event goes live immediately at a club we
    // have never seen, so an admin needs enough to identify and set it up.
    const clubCheck = validateProposedClub(newClub, { requireWebsite: true })
    if (!clubCheck.valid) return NextResponse.json({ error: clubCheck.errors[0] }, { status: 400 })

    const clubName = String(newClub.name).trim()
    const website = String(newClub.website).trim()

    const resolved = resolveDates()
    if (resolved.error || !resolved.dates) {
      return NextResponse.json({ error: resolved.error }, { status: 400 })
    }
    eventDates = resolved.dates
    // Free text the host typed — sanitise like any other free-form field.
    teeTime = typeof body.tee_time === 'string' && body.tee_time.trim()
      ? sanitiseText(body.tee_time.trim())
      : null

    // One pending course for the club, however many dates are being listed at it.
    const result = await requestPendingCourse({ admin, name: clubName, website, requestedBy: ctx.memberId })
    if (result.error || !result.course) {
      return NextResponse.json({ error: result.error ?? 'Could not add the club.' }, { status: result.status ?? 500 })
    }
    courseId = result.course.id
    courseName = clubName
  } else {
    // ---- A newly proposed schedule at an existing course ---------------
    const { valid, errors } = validateHostedEventPayload(body)
    if (!valid) return NextResponse.json({ error: errors[0] }, { status: 400 })

    const resolved = resolveDates()
    if (resolved.error || !resolved.dates) {
      return NextResponse.json({ error: resolved.error }, { status: 400 })
    }
    eventDates = resolved.dates
    courseId = String(body.course_id)
    // Free text the host typed — sanitise like any other free-form field.
    teeTime = typeof body.tee_time === 'string' && body.tee_time.trim()
      ? sanitiseText(body.tee_time.trim())
      : null

    // A host scoped to specific venues can only propose events there. An empty
    // set means unrestricted (legacy hosts), matching the event form's fallback.
    if (!(await hostCanUseCourse(admin, ctx.host.id, courseId))) {
      return NextResponse.json({ error: 'You can only host events at your approved venues.' }, { status: 400 })
    }
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

  // The course must exist and be bookable — except the new_club path, whose
  // course is intentionally pending until an admin approves it.
  if (!newClub) {
    const { data: course } = await admin
      .from('courses')
      .select('id, name, approval_status')
      .eq('id', courseId)
      .maybeSingle()
    if (!course) {
      return NextResponse.json({ error: 'That course is not available for events.' }, { status: 400 })
    }

    // A pending course is allowed here only when this host was explicitly granted
    // it as a venue. That's the club they proposed and an admin approved them for,
    // so refusing it would strand them: the venue sits in their dropdown while
    // every attempt to use it fails. Checked against an actual host_venues row
    // rather than hostCanUseCourse, whose empty-set-means-unrestricted rule would
    // otherwise let an unscoped host pick any pending course.
    if (course.approval_status !== 'active') {
      const { data: grantedVenue } = await admin
        .from('host_venues')
        .select('course_id')
        .eq('host_id', ctx.host.id)
        .eq('course_id', courseId)
        .maybeSingle()
      if (course.approval_status !== 'pending' || !grantedVenue) {
        return NextResponse.json({ error: 'That course is not available for events.' }, { status: 400 })
      }
    }

    courseName = course.name
  }

  // Creating an event does not publish it. It lands in 'pending_approval',
  // invisible to members, and an admin approves it once the GHL calendar behind
  // it exists (POST /api/admin/hosted-events/[id], action 'approve'). The push
  // below is what puts it in front of them.
  const dinner = body.dinner === true

  // One row per date, inserted together so a partial failure can't leave half a
  // schedule live. Dates are sorted so the response and the "created" notification
  // read in chronological order regardless of what order they were typed in.
  const orderedDates = [...eventDates].sort()

  const { data: created, error } = await admin
    .from('hosted_events')
    .insert(orderedDates.map(date => ({
      host_id: ctx.host.id,
      course_id: courseId,
      event_date: date,
      tee_time: teeTime,
      total_spots: spots,
      member_guest_rate: rate,
      dinner,
      // Only the single booking-sourced event carries this; the partial unique
      // index would reject a second row holding the same booking.
      source_booking_id: sourceBookingId,
      // Not live yet. An admin approves it — which is when the GHL calendar
      // behind it gets created — and approval is what makes it 'upcoming'.
      status: 'pending_approval',
    })))
    .select()

  if (error) {
    // The partial unique index on source_booking_id — this booking is already
    // listed as a live event.
    if (error.code === '23505') {
      return NextResponse.json({ error: 'That booking is already listed as an event.' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const events = created ?? []
  const event = events[0]
  if (!event) {
    return NextResponse.json({ error: 'Could not create the event.' }, { status: 500 })
  }

  // Nothing is live yet — this push is the only thing that tells an admin there's
  // something waiting to be set up and approved, so the host isn't left sitting in
  // a queue nobody knows about (best-effort; a push failure must not fail the
  // creation the host just completed). One push for the batch rather than one per
  // date, keyed on the earliest — a host listing ten dates shouldn't produce ten
  // identical notifications.
  void sendPushToAdmins(
    NotificationTemplates.hostedEventNeedsReview(ctx.host.name, courseName, orderedDates[0] ?? '')
  ).catch(() => {})

  logger.info('Hosted event created', {
    action: 'host.event.created',
    userId: ctx.userId,
    metadata: {
      event_id: event.id,
      event_count: events.length,
      host_id: ctx.host.id,
      from_booking: !!sourceBookingId,
      new_club: !!newClub,
    },
  })

  // `event` is the first for backwards compatibility; `events` is the full set.
  return NextResponse.json({ event, events }, { status: 201 })
})
