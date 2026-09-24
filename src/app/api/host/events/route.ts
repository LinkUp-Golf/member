export const dynamic = 'force-dynamic'

// GET  /api/host/events — the caller's own hosted events, with spot counts.
// POST /api/host/events — create a hosted event. It goes live immediately.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withHostAuth, type HostAuthContext } from '@/lib/auth/with-host-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { validateHostedEventPayload, normaliseEventDates } from '@/lib/validation'
import { enrichHostedEvents, hostCanUseCourse, resolveTeeTimes } from '@/lib/hosts/events'
import { describeRoundConflict, findRoundConflicts, loadOccupyingRounds } from '@/lib/hosts/schedule'
import {
  ensureCourseCalendar,
  ensureHostGhlUser,
  hostUserIdsForCourse,
} from '@/lib/hosts/provisioning'
import { openSpotsByDate } from '@/lib/bookings/availability'
import { sendPushToAdmins, NotificationTemplates } from '@/lib/push'
import { logger } from '@/lib/logger'
import { HOST_EVENT_GUEST_RATE_USD } from '@/lib/constants'
import { parsePaymentOptions, coursePaymentOptions } from '@/lib/bookings/payment-options'
import type { Course, HostedEvent } from '@/types'

const todayISO = () => new Date().toISOString().slice(0, 10)

export const GET = withHostAuth(async (_req: NextRequest, ctx: HostAuthContext) => {
  const admin = createAdminClient()

  // Proofs come along because the list is where a host looks to see whether
  // they've already submitted one. Without them every row's button read
  // "Upload pic" no matter what had been sent — the status can't answer it,
  // since a same-day upload deliberately leaves the event 'upcoming'.
  const { data, error } = await admin
    .from('hosted_events')
    .select('*, course:courses(id, name), proofs:hosted_event_proofs(id, image_url, created_at)')
    .eq('host_id', ctx.host.id)
    .order('event_date', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const events = await enrichHostedEvents(admin, (data ?? []) as HostedEvent[])
  return NextResponse.json({ events })
})

export const POST = withHostAuth(async (req: NextRequest, ctx: HostAuthContext) => {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>

  const admin = createAdminClient()

  // Hosting is normally for venues already on LinkUp, on days that venue has
  // open. A club the host proposed is the exception, and it arrives here as an
  // ordinary pending course with the host's own spots and rate — see the
  // proposedVenue branch below.
  //
  // Adopting one of the host's own bookings was removed as the flow settled:
  // course, date and tee time came from the booking, which the date picker now
  // supplies from the venue itself. Existing events created that way still edit
  // and cancel.
  let courseId: string
  /** One event per date, sharing the course and dinner setting. */
  let eventDates: string[]
  /** Each date's own tee time, keyed by date — see resolveTeeTimes. */
  let teeTimes: Map<string, string | null>

  /** The dates asked for, rejecting any that have already passed. */
  const resolveDates = (): { dates?: string[]; error?: string } => {
    const dates = normaliseEventDates(body)
    if (!dates || dates.length === 0) return { error: 'Choose at least one date.' }
    if (dates.some(d => d < todayISO())) {
      return { error: 'Event date cannot be in the past.' }
    }
    return { dates }
  }

  {
    const { valid, errors } = validateHostedEventPayload(body)
    if (!valid) return NextResponse.json({ error: errors[0] }, { status: 400 })

    const resolved = resolveDates()
    if (resolved.error || !resolved.dates) {
      return NextResponse.json({ error: resolved.error }, { status: 400 })
    }
    eventDates = resolved.dates
    courseId = String(body.course_id)
    // What each date tees off at, sanitised — the row per date stores its own.
    teeTimes = resolveTeeTimes(eventDates, body)

    // How members pay at this venue. Optional — an older client doesn't send
    // it, and then the venue's setting is left alone — but if sent it has to be
    // a real, non-empty set, because it's written onto the course below.
    if (body.payment_options !== undefined && !parsePaymentOptions(body.payment_options)) {
      return NextResponse.json({ error: 'Choose at least one payment option.' }, { status: 400 })
    }

    // A host scoped to specific venues can only propose events there. An empty
    // set means unrestricted (legacy hosts), matching the event form's fallback.
    if (!(await hostCanUseCourse(admin, ctx.host.id, courseId))) {
      return NextResponse.json({ error: 'You can only host events at your approved venues.' }, { status: 400 })
    }
  }

  // The course must exist and be bookable.
  // The whole row: openSpotsByDate needs the calendar id, timezone, daily cap
  // and curated-slot flag to work out what the venue actually has open.
  const { data: course } = await admin
    .from('courses')
    .select('*')
    .eq('id', courseId)
    .maybeSingle()
  if (!course) {
    return NextResponse.json({ error: 'That course is not available for events.' }, { status: 400 })
  }

  // A pending course is allowed only when this host was explicitly granted it as
  // a venue — a club an admin set them up for but hasn't finished listing.
  // Refusing it would strand them: the venue sits in their dropdown while every
  // attempt to use it fails. Checked against an actual host_venues row rather
  // than hostCanUseCourse, whose empty-set-means-unrestricted rule would
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

  // A club we don't have yet — proposed from the event form's "New LinkUp" tab,
  // which created it as a pending course moments ago.
  //
  // Terms are the server's to set at a listed venue: the rate is fixed so two
  // hosts can't price the same round differently, and capacity is whatever the
  // venue has open that day. Neither is answerable here. There is no calendar to
  // ask for open days and no rate agreed with a club we haven't spoken to, so
  // the host is the only source for both and sends them.
  //
  // The events are still real rows from the start, in pending_approval like any
  // other. That is the point of doing it this way rather than filing a note: the
  // host is attached to the rounds before anyone sets the club up, so approving
  // the club approves the rounds someone is already waiting on.
  const proposedVenue = course.approval_status === 'pending'
  let hostSetSpots = 0
  let rate = HOST_EVENT_GUEST_RATE_USD

  if (proposedVenue) {
    hostSetSpots = Number(body.total_spots)
    rate = Number(body.member_guest_rate)
    // validateHostedEventPayload bounds both when present; this is the rule that
    // they have to BE present, which only applies on this path.
    if (!Number.isInteger(hostSetSpots) || hostSetSpots < 1) {
      return NextResponse.json(
        { error: 'Tell us the number of guests this venue can take.' },
        { status: 400 }
      )
    }
    if (!Number.isFinite(rate) || rate < 0) {
      return NextResponse.json(
        { error: 'Tell us the member guest rate for this venue.' },
        { status: 400 }
      )
    }
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

  // Capacity is whatever the venue actually has open that day — two days at the
  // same club rarely have the same room, so a flat number would either oversell
  // the thin ones or waste the busy ones. A booking-sourced event is bounded by
  // the seats the booking itself holds instead.
  const spotsFor = new Map<string, number>()
  if (proposedVenue) {
    // Nothing to check the dates against — the club has no calendar yet. Every
    // day carries what the host said the venue can take.
    for (const date of orderedDates) spotsFor.set(date, hostSetSpots)
  } else {
    const open = await openSpotsByDate(admin, course as Course, orderedDates)
    for (const date of orderedDates) {
      const spots = open.get(date)
      // The host picked from this venue's open days, but a day can fill between
      // choosing it and submitting. Better to say so than to list a round with no
      // seats behind it.
      if (!spots) {
        return NextResponse.json(
          { error: `${date} is no longer open at ${course.name}. Remove it and try again.` },
          { status: 409 }
        )
      }
      spotsFor.set(date, spots)
    }
  }

  // Nobody else may already hold these blocks of the club's day.
  //
  // The venue's calendar is one tee sheet. Two hosts on overlapping times at the
  // same club is the same seats promised twice, and it stays invisible until
  // somebody creates the second calendar over the first — so it's refused at the
  // door, naming the round and the host it runs into. The caller's own rounds
  // count: listing the same block twice is the same double-booking with one
  // fewer person involved.
  {
    const occupied = await loadOccupyingRounds(admin, {
      courseId,
      dates: orderedDates,
    })
    const conflicts = findRoundConflicts(
      orderedDates.map(date => ({
        date,
        teeTime: teeTimes.get(date) ?? null,
        hostId: ctx.host.id,
        hostName: ctx.host.name,
      })),
      occupied,
      Number(course.meeting_duration_mins),
    )
    const first = conflicts[0]
    if (first) {
      return NextResponse.json(
        { error: describeRoundConflict(first, course.name as string) },
        { status: 409 }
      )
    }
  }

  // Payment options belong to the venue, not to these rounds: every booking at
  // the course follows them. The host sets them from the event form — the
  // venue checks above are what entitle them to — so they're written before the
  // rounds, and a failure stops here rather than listing rounds on terms the
  // host didn't choose.
  const paymentOptions = parsePaymentOptions(body.payment_options)
  if (
    paymentOptions &&
    paymentOptions.join(',') !== coursePaymentOptions(course).join(',')
  ) {
    const { error: optionsError } = await admin
      .from('courses')
      .update({ payment_options: paymentOptions })
      .eq('id', courseId)
    if (optionsError) {
      return NextResponse.json({ error: optionsError.message }, { status: 500 })
    }
  }

  const { data: created, error } = await admin
    .from('hosted_events')
    .insert(orderedDates.map(date => ({
      host_id: ctx.host.id,
      course_id: courseId,
      event_date: date,
      tee_time: teeTimes.get(date) ?? null,
      total_spots: spotsFor.get(date) ?? 1,
      member_guest_rate: rate,
      dinner,
      // Not live yet. An admin approves it — which is when the GHL calendar
      // behind it gets created — and approval is what makes it 'upcoming'.
      status: 'pending_approval',
    })))
    .select()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

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
    NotificationTemplates.hostedEventNeedsReview(
      ctx.host.name,
      course.name,
      orderedDates[0] ?? '',
      orderedDates.length,
    )
  ).catch(() => {})

  // Set the venue up in GHL, so the rounds the host just submitted have
  // something to book against by the time anyone looks at them.
  //
  // A club the host proposed arrives with no calendar at all, and an admin
  // approving the venue used to be the first moment one existed. Doing it here
  // makes the review a decision rather than a setup — and the host's own GHL
  // user goes on the calendar, so appointments are assigned to the person
  // actually running the round.
  //
  // After the insert and deliberately non-fatal: the rounds are the host's and
  // must not be lost to a GHL outage. Course approval still calls the same
  // helper, which no-ops once a calendar exists.
  let calendarId: string | null = course.ghl_calendar_id as string | null
  try {
    // Read only when there's no GHL user yet — the common path is a host who
    // already has one, and that returns without touching the database.
    const person = ctx.host.ghl_user_id
      ? null
      : (
          await admin
            .from('members')
            .select('first_name, last_name, email, phone')
            .eq('id', ctx.memberId)
            .maybeSingle()
        ).data

    const hostUserId = await ensureHostGhlUser(
      admin,
      { id: ctx.host.id, name: ctx.host.name, ghl_user_id: ctx.host.ghl_user_id },
      {
        first_name: person?.first_name ?? null,
        last_name: person?.last_name ?? null,
        email: person?.email ?? ctx.email,
        phone: person?.phone ?? null,
      },
    )

    // This host first, then anyone else already granted the venue — the first
    // id becomes the calendar's primary.
    const others = await hostUserIdsForCourse(admin, courseId)
    const teamMemberIds = Array.from(
      new Set([...(hostUserId ? [hostUserId] : []), ...others]),
    )

    calendarId = await ensureCourseCalendar(admin, course as Course, teamMemberIds)
  } catch (err) {
    logger.error('Venue setup after hosted event creation failed', {
      action: 'host.event.venue_setup_failed',
      userId: ctx.userId,
      errorMessage: String(err),
      metadata: { course_id: courseId, host_id: ctx.host.id },
    })
  }

  logger.info('Hosted event created', {
    action: 'host.event.created',
    userId: ctx.userId,
    metadata: {
      event_id: event.id,
      event_count: events.length,
      host_id: ctx.host.id,
      course_id: courseId,
      ghl_calendar_id: calendarId,
    },
  })

  // `event` is the first for backwards compatibility; `events` is the full set.
  return NextResponse.json({ event, events, ghl_calendar_id: calendarId }, { status: 201 })
})
