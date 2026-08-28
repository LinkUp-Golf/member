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
// The event form's "New LinkUp" tab calls this first and then POSTs the rounds
// it wants to /api/host/events against the course id this returns. That's what
// ties the host to the events: they're real hosted_events rows from the start,
// waiting on the same admin approval as any other, rather than a note for
// someone to retype.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { validateProposedClub } from '@/lib/validation'
import { requestPendingCourse } from '@/lib/courses/request-course'
import { logger } from '@/lib/logger'
import type { AuthContext } from '@/lib/auth/types'

export const POST = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  const body = (await req.json().catch(() => ({}))) as { name?: string; website?: string }

  // One rule for every caller, so the same club proposed from the event form and
  // from the application can't come out different. The website stays optional: an
  // admin reviews each of these by hand, and refusing the club outright over a
  // URL the host may not have to hand loses more than it saves.
  const { valid, errors } = validateProposedClub(body)
  if (!valid) return NextResponse.json({ error: errors[0] }, { status: 400 })

  const website = typeof body.website === 'string' && body.website.trim() ? body.website.trim() : null

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
