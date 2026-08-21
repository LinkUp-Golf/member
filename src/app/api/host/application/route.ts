export const dynamic = 'force-dynamic'

// GET  /api/host/application — the caller's application status, plus their host
//        row once approved.
// POST /api/host/application — apply to become a host.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { validateHostApplicationPayload, sanitiseText } from '@/lib/validation'
import { logger } from '@/lib/logger'
import { HOST_EVENT_GUEST_RATE_USD } from '@/lib/constants'
import { openSpotsByDate } from '@/lib/bookings/availability'
import type { AuthContext } from '@/lib/auth/types'
import type { Course, HostApplicationEventInput } from '@/types'

/**
 * A proposed round as it arrives on the wire. `venue` replaces `course_id` — it
 * held either a course id or a `new:<index>` reference back when an applicant
 * could name a club we didn't have. That path is gone; a venue is now always an
 * existing course, and the field keeps its name so older clients still parse.
 */
type ProposedRoundInput = Omit<HostApplicationEventInput, 'course_id'> & { venue?: string }

// skipGHLCheck: this is a status read, and the live GHL round-trip made it 503
// whenever GHL was unavailable — which the page turned into a blank "apply" form
// for someone who already had an application in flight. The host workspace routes
// skip it for the same reason.
export const GET = withAuth(async (_req: NextRequest, ctx: AuthContext) => {
  const admin = createAdminClient()

  // Most recent application — the member may have been rejected and re-applied.
  // The proposed rounds come with it so the "under review" card can show what was
  // actually submitted rather than just that something was.
  const { data: application } = await admin
    .from('host_applications')
    .select('*, events:host_application_events(*, course:courses(id, name, city, approval_status))')
    .eq('member_id', ctx.memberId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // The host row is the role itself, so report it independently of the
  // application — an admin can grant the role without an application existing.
  const { data: host } = await admin
    .from('hosts')
    .select('id, name, status, venues_unrestricted')
    .eq('member_id', ctx.memberId)
    .maybeSingle()

  // Which venues the approval actually granted. The member was previously never
  // told this anywhere — the only way to find out was to open the event form and
  // read the course dropdown.
  let venues: { id: string; name: string; city: string | null; approval_status: string }[] = []
  if (host) {
    const { data: venueRows } = await admin
      .from('host_venues')
      .select('course:courses(id, name, city, approval_status)')
      .eq('host_id', host.id)

    type VenueRow = { id: string; name: string; city: string | null; approval_status: string }
    venues = (venueRows ?? [])
      .map(r => (Array.isArray(r.course) ? r.course[0] : r.course) as VenueRow | null)
      .filter((c): c is VenueRow => !!c)
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  return NextResponse.json({ application: application ?? null, host: host ?? null, venues })
}, { skipGHLCheck: true })

export const POST = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  const body = await req.json().catch(() => ({})) as {
    name?: string
    description?: string
    course_ids?: string[]
    events?: ProposedRoundInput[]
  }

  const { valid, errors } = validateHostApplicationPayload(body)
  if (!valid) return NextResponse.json({ error: errors[0] }, { status: 400 })

  const name = body.name?.trim() ?? ''
  // No longer collected by the form; kept nullable so an older client that
  // still sends one doesn't lose it.
  const description = body.description?.trim() || null

  const admin = createAdminClient()

  // Existing venues must be real courses, but they need not be bookable yet: a
  // club proposed on an earlier application exists as a `pending` course, and that
  // is exactly the venue being applied for. Excluding pending here is what used to
  // make an unlisted club unapplicable-for.
  //
  // The approval route applies the same widened filter; the two must agree or an
  // approval silently drops the venue it was granting.
  const requestedIds = Array.from(new Set(body.course_ids ?? []))
  let requestedCourseIds: string[] = []
  // Kept whole rather than as ids alone: working out what a venue has open on a
  // date needs its calendar id, timezone, daily cap and curated-slot flag.
  const coursesById = new Map<string, Course>()
  if (requestedIds.length) {
    const { data: validCourses } = await admin
      .from('courses')
      .select('*')
      .in('id', requestedIds)
      .eq('active', true)
      .in('approval_status', ['active', 'pending'])
    for (const c of (validCourses ?? []) as Course[]) coursesById.set(c.id, c)
    requestedCourseIds = Array.from(coursesById.keys())
  }
  if (requestedCourseIds.length === 0) {
    return NextResponse.json({ error: 'Choose at least one valid venue.' }, { status: 400 })
  }

  // Already a host — nothing to apply for.
  const { data: existingHost } = await admin
    .from('hosts')
    .select('id')
    .eq('member_id', ctx.memberId)
    .maybeSingle()
  if (existingHost) {
    return NextResponse.json({ error: 'You are already a host.' }, { status: 409 })
  }

  // Re-applying while a review is open is a no-op, not a duplicate row. The
  // partial unique index is the race-safe backstop for this check.
  const { data: pending } = await admin
    .from('host_applications')
    .select('id')
    .eq('member_id', ctx.memberId)
    .eq('status', 'pending')
    .maybeSingle()
  if (pending) {
    return NextResponse.json({ error: 'You already have an application under review.' }, { status: 409 })
  }

  const { data, error } = await admin
    .from('host_applications')
    .insert({
      member_id: ctx.memberId,
      name: sanitiseText(name),
      description: description ? sanitiseText(description) : null,
      requested_course_ids: requestedCourseIds,
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'You already have an application under review.' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Rounds the applicant proposed. `venue` is a course id. Anything that doesn't
  // resolve to a granted venue is dropped rather than carried, so approval can't
  // try to create an event at a course the host was never given.
  const proposed = Array.isArray(body.events) ? body.events : []
  const kept = proposed
    .map(ev => ({ ev, courseId: String(ev.venue ?? '') }))
    .filter((r): r is { ev: ProposedRoundInput; courseId: string } =>
      !!r.courseId && requestedCourseIds.includes(r.courseId)
    )

  // Capacity is what each venue actually has open that day, exactly as a hosted
  // event created directly gets it — a flat number would either oversell the
  // thin days or waste the busy ones. Looked up per course so a schedule across
  // several clubs costs one pass each, not one per round.
  //
  // A round whose day has since filled is dropped rather than rejected: an
  // application is a proposal an admin reviews, so losing one date shouldn't
  // cost the applicant the whole submission.
  const spotsByCourse = new Map<string, Map<string, number>>()
  for (const courseId of new Set(kept.map(r => r.courseId))) {
    const course = coursesById.get(courseId)
    if (!course) continue
    const datesForCourse = kept.filter(r => r.courseId === courseId).map(r => String(r.ev.event_date))
    spotsByCourse.set(courseId, await openSpotsByDate(admin, course, datesForCourse))
  }

  const rounds = kept
    .map(({ ev, courseId }) => ({
      ev,
      courseId,
      spots: spotsByCourse.get(courseId)?.get(String(ev.event_date)) ?? 0,
    }))
    .filter(r => r.spots > 0)
    .map(({ ev, courseId, spots }) => ({
      application_id: data.id,
      course_id: courseId,
      event_date: String(ev.event_date),
      // Free text the applicant typed — sanitise like every other free-form field.
      tee_time: typeof ev.tee_time === 'string' && ev.tee_time.trim()
        ? sanitiseText(ev.tee_time.trim())
        : null,
      total_spots: spots,
      // A fixed term, same as a hosted event created directly — these rows
      // become hosted_events on approval, so they can't be listed at a
      // different rate from one another.
      member_guest_rate: HOST_EVENT_GUEST_RATE_USD,
      dinner: ev.dinner === true,
    }))

  if (rounds.length) {
    const { error: roundsError } = await admin.from('host_application_events').insert(rounds)
    if (roundsError) {
      // The application itself is the thing being applied for, so don't fail the
      // whole submission over the proposals — but don't lose them silently either.
      // Roll back so the member can resubmit rather than land in a review whose
      // dates quietly vanished.
      await admin.from('host_applications').delete().eq('id', data.id)
      return NextResponse.json({ error: roundsError.message }, { status: 500 })
    }
  }

  if (proposed.length !== rounds.length) {
    logger.warn('Host application dropped rounds at unrequested venues', {
      action: 'host.application.rounds_dropped',
      userId: ctx.userId,
      metadata: { application_id: data.id, submitted: proposed.length, kept: rounds.length },
    })
  }

  logger.info('Host application submitted', {
    action: 'host.application.submitted',
    userId: ctx.userId,
    metadata: { application_id: data.id },
  })

  return NextResponse.json({ application: data }, { status: 201 })
})
