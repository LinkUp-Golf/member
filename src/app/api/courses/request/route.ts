export const dynamic = 'force-dynamic'

// POST /api/courses/request — a member proposes a golf club that isn't yet on
// LinkUp. The club is created as a `pending` course (see requestPendingCourse)
// and lands in the admin golf-events "Pending" queue for an admin to set up and
// approve into a live, bookable course.
//
// Both host surfaces that can name a club call this one endpoint — the become-a-
// host application (AddVenueControl) and the "New LinkUp" tab on the host's own
// event form — so the same club proposed from either place produces the same
// row. Neither submits a proposed club as part of its own payload: they propose
// it here first, which is why the application and event validators can insist on
// a real course id.
//
// The event form also sends what the host wants to run there: free-text dates,
// slots per day, a guest rate. None of it becomes anything on its own — the team
// sets those into a GHL calendar event by hand once the club is set up — so it
// isn't stored on the course. It's written to admin_audit_log against the
// course, which the admin Courses queue reads back as the host's brief. No
// column for it, because nothing in the app ever acts on it.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { validateProposedClub, sanitiseText } from '@/lib/validation'
import { requestPendingCourse } from '@/lib/courses/request-course'
import { logger } from '@/lib/logger'
import type { AuthContext } from '@/lib/auth/types'

export const POST = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  const body = (await req.json().catch(() => ({}))) as {
    name?: string
    website?: string
    // The "New LinkUp" tab's schedule. All three or none — see
    // validateProposedClub.
    event_dates?: string
    slots_per_day?: number | string
    member_guest_rate?: number | string
  }

  // One rule for every caller, so the same club proposed from the event form and
  // from the application can't come out different. The website stays optional: an
  // admin reviews each of these by hand, and refusing the club outright over a
  // URL the host may not have to hand loses more than it saves.
  const { valid, errors } = validateProposedClub(body)
  if (!valid) return NextResponse.json({ error: errors[0] }, { status: 400 })

  const website = typeof body.website === 'string' && body.website.trim() ? body.website.trim() : null

  // Validation above already rejected a half-filled schedule, so the presence of
  // the dates is enough to know the whole thing is here.
  const schedule =
    typeof body.event_dates === 'string' && body.event_dates.trim()
      ? {
          event_dates: sanitiseText(body.event_dates.trim()),
          slots_per_day: Number(body.slots_per_day),
          member_guest_rate: Number(body.member_guest_rate),
        }
      : null

  const admin = createAdminClient()
  const result = await requestPendingCourse({
    admin,
    name: (body.name ?? '').trim(),
    website,
    requestedBy: ctx.memberId,
  })

  if (result.error || !result.course) {
    return NextResponse.json({ error: result.error ?? 'Could not add the club.' }, { status: result.status ?? 500 })
  }

  // A host who proposes a club is proposing somewhere to host, so grant them
  // the venue. Without this the club they just added isn't in their own venue
  // list and POST /api/host/events refuses it — a pending course is only
  // hostable by a host with an explicit host_venues row. The course itself is
  // still pending, so this grants nothing an admin hasn't yet approved: it's
  // the same grant course approval already makes for hosts with events there.
  // Best-effort — the club is requested either way.
  let grantedVenue = false
  try {
    const { data: host } = await admin
      .from('hosts')
      .select('id')
      .eq('member_id', ctx.memberId)
      .eq('status', 'active')
      .maybeSingle()
    if (host) {
      const { error: grantError } = await admin
        .from('host_venues')
        .upsert({ host_id: host.id, course_id: result.course.id }, {
          onConflict: 'host_id,course_id',
          ignoreDuplicates: true,
        })
      grantedVenue = !grantError
    }
  } catch (err) {
    logger.warn('Host venue grant failed for requested course', {
      action: 'course.requested.grant_failed',
      userId: ctx.userId,
      metadata: { course_id: result.course.id, error: String(err) },
    })
  }

  // The host's brief, for whoever sets the club up. It lives in the audit log
  // rather than on the course because nothing in the app reads it to make a
  // decision — a person does, once, and then builds the GHL calendar event from
  // it. Best-effort: the club is what the host is waiting on.
  if (schedule) {
    try {
      await admin.from('admin_audit_log').insert({
        admin_id: ctx.memberId,
        action: 'courses.requested_schedule',
        target_type: 'course',
        target_id: result.course.id,
        payload: schedule,
      })
    } catch (err) {
      logger.warn('Could not record the requested schedule', {
        action: 'course.requested.schedule_failed',
        userId: ctx.userId,
        metadata: { course_id: result.course.id, error: String(err) },
      })
    }
  }

  logger.info('Course requested by member', {
    action: 'course.requested',
    userId: ctx.userId,
    metadata: {
      course_id: result.course.id,
      reused: !!result.alreadyRequested,
      granted_venue: grantedVenue,
    },
  })

  return NextResponse.json(
    { course: result.course, alreadyRequested: !!result.alreadyRequested },
    { status: result.alreadyRequested ? 200 : 201 },
  )
})
