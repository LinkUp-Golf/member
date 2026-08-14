export const dynamic = 'force-dynamic'

// GET  /api/host/application — the caller's application status, plus their host
//        row once approved.
// POST /api/host/application — apply to become a host.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { validateHostApplicationPayload, sanitiseText, NEW_VENUE_REF } from '@/lib/validation'
import { requestPendingCourse } from '@/lib/courses/request-course'
import { logger } from '@/lib/logger'
import type { AuthContext } from '@/lib/auth/types'
import type { HostApplicationEventInput } from '@/types'

/**
 * A proposed round as it arrives on the wire. `venue` replaces `course_id`: a club
 * created by this very request has no id yet, so rounds at one reference it as
 * `new:<index>` into `new_venues`.
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
    new_venues?: { name?: string; website?: string | null }[]
    events?: ProposedRoundInput[]
  }

  const { valid, errors } = validateHostApplicationPayload(body)
  if (!valid) return NextResponse.json({ error: errors[0] }, { status: 400 })

  const name = body.name?.trim() ?? ''
  // No longer collected by the form; kept nullable so an older client that
  // still sends one doesn't lose it.
  const description = body.description?.trim() || null
  const newVenues = Array.isArray(body.new_venues) ? body.new_venues : []

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
  if (requestedIds.length) {
    const { data: validCourses } = await admin
      .from('courses')
      .select('id')
      .in('id', requestedIds)
      .eq('active', true)
      .in('approval_status', ['active', 'pending'])
    requestedCourseIds = (validCourses ?? []).map(c => c.id)
  }
  if (requestedCourseIds.length === 0 && newVenues.length === 0) {
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

  // Create the clubs the applicant named that aren't on LinkUp yet. This happens
  // here, on submission — not when they typed the name — so abandoning the form
  // doesn't leave a pending course sitting in the admin queue for an application
  // that was never made. requestPendingCourse dedupes by slug, so a resubmission
  // after a failure reuses the same row rather than piling up near-duplicates.
  //
  // Index order is load-bearing: rounds reference these venues as `new:<index>`.
  const createdVenueIds: string[] = []
  for (const venue of newVenues) {
    const result = await requestPendingCourse({
      admin,
      name: String(venue.name ?? '').trim(),
      website: typeof venue.website === 'string' ? venue.website.trim() || null : null,
      requestedBy: ctx.memberId,
    })

    if (result.error || !result.course) {
      return NextResponse.json(
        { error: result.error ?? 'Could not add one of the new venues.' },
        { status: result.status ?? 500 }
      )
    }
    createdVenueIds.push(result.course.id)
  }

  // Both kinds of venue are just courses from here on.
  const allVenueIds = Array.from(new Set([...requestedCourseIds, ...createdVenueIds]))

  const { data, error } = await admin
    .from('host_applications')
    .insert({
      member_id: ctx.memberId,
      name: sanitiseText(name),
      description: description ? sanitiseText(description) : null,
      requested_course_ids: allVenueIds,
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'You already have an application under review.' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Rounds the applicant proposed. `venue` is either a course id or a
  // `new:<index>` reference into new_venues, now resolvable to a real course.
  // Anything that doesn't resolve to a granted venue is dropped rather than
  // carried, so approval can't try to create an event at a course the host was
  // never given.
  const proposed = Array.isArray(body.events) ? body.events : []
  const rounds = proposed
    .map(ev => {
      const ref = String(ev.venue ?? '')
      const courseId = ref.startsWith(NEW_VENUE_REF)
        ? createdVenueIds[Number(ref.slice(NEW_VENUE_REF.length))]
        : ref
      return { ev, courseId }
    })
    .filter((r): r is { ev: ProposedRoundInput; courseId: string } =>
      !!r.courseId && allVenueIds.includes(r.courseId)
    )
    .map(({ ev, courseId }) => ({
      application_id: data.id,
      course_id: courseId,
      event_date: String(ev.event_date),
      // Free text the applicant typed — sanitise like every other free-form field.
      tee_time: typeof ev.tee_time === 'string' && ev.tee_time.trim()
        ? sanitiseText(ev.tee_time.trim())
        : null,
      total_spots: Number(ev.total_spots),
      member_guest_rate: Number(ev.member_guest_rate),
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
