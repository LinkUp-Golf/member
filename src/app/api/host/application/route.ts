export const dynamic = 'force-dynamic'

// GET  /api/host/application — the caller's host row and the venues it grants.
// POST /api/host/application — become a host.
//
// There is no review. A member who submits this is a host when the request
// returns: the GHL account, the role, the venues, the rounds they proposed and
// the calendars those rounds book against all exist, and the page sends them
// straight to the host workspace.
//
// The order matters, and it runs outside-in. The GHL user comes first and is
// required — everything after it is staffed by that account, and a hosts row
// without one is the half-state this used to leave behind. The venue calendars
// come last, once there is a host to put on them.
//
// It used to write a row to host_applications and wait for an admin, who then
// did everything below from /admin/hosts. That queue is gone along with its
// table — the admin was approving essentially every application, and the wait
// was the only thing between a member deciding to host and being able to. What
// is left of the gate is where it always mattered: an individual round is still
// created `pending_approval` and needs a calendar before a member can book it.
//
// The path keeps its name so an older client still reaches it.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { validateHostApplicationPayload, sanitiseText } from '@/lib/validation'
import { logger } from '@/lib/logger'
import { HOST_EVENT_GUEST_RATE_USD } from '@/lib/constants'
import { openSpotsByDate } from '@/lib/bookings/availability'
import {
  provisionGhlUser,
  hostUserIdsForCourse,
  ensureCourseCalendar,
  syncHostAvailability,
} from '@/lib/hosts/provisioning'
import { addTagToContact } from '@/lib/ghl/client'
import { HOST_ROLE_TAG } from '@/lib/ghl/tags'
import type { AuthContext } from '@/lib/auth/types'
import type { Course, Host, HostApplicationEventInput } from '@/types'

/**
 * A proposed round as it arrives on the wire. `venue` holds a course id; the
 * field keeps its name so older clients still parse.
 */
type ProposedRoundInput = Omit<HostApplicationEventInput, 'course_id'> & { venue?: string }

interface VenueSummary {
  id: string
  name: string
  city: string | null
  approval_status: string
}

/** The venues a host may list rounds at. */
async function venuesForHost(
  admin: ReturnType<typeof createAdminClient>,
  hostId: string,
): Promise<VenueSummary[]> {
  const { data } = await admin
    .from('host_venues')
    .select('course:courses(id, name, city, approval_status)')
    .eq('host_id', hostId)

  return (data ?? [])
    .map(r => (Array.isArray(r.course) ? r.course[0] : r.course) as VenueSummary | null)
    .filter((c): c is VenueSummary => !!c)
    .sort((a, b) => a.name.localeCompare(b.name))
}

// skipGHLCheck: this is a status read, and the live GHL round-trip made it 503
// whenever GHL was unavailable — which the page turned into a blank "apply" form
// for someone who is already a host. The host workspace routes skip it too.
export const GET = withAuth(async (_req: NextRequest, ctx: AuthContext) => {
  const admin = createAdminClient()

  const { data: host } = await admin
    .from('hosts')
    .select('id, name, status, venues_unrestricted')
    .eq('member_id', ctx.memberId)
    .maybeSingle()

  // `application` is still in the response, always null, so a client that
  // hasn't been reloaded doesn't read undefined and render a broken card.
  return NextResponse.json({
    application: null,
    host: host ?? null,
    venues: host ? await venuesForHost(admin, host.id) : [],
  })
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

  const admin = createAdminClient()

  // Venues must be real courses, but need not be bookable yet: a club proposed
  // through New LinkUp exists as a `pending` course, and that is exactly the
  // venue being asked for.
  const requestedIds = Array.from(new Set(body.course_ids ?? []))
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
  }
  const grantedVenueIds = Array.from(coursesById.keys())
  if (grantedVenueIds.length === 0) {
    return NextResponse.json({ error: 'Choose at least one valid venue.' }, { status: 400 })
  }

  const { data: member } = await admin
    .from('members')
    .select('first_name, last_name, email, phone, ghl_contact_id, ghl_tags')
    .eq('id', ctx.memberId)
    .maybeSingle()

  // A host is named after the member. The form used to ask for a nickname,
  // which meant a host could appear under a name no other member recognised.
  const hostName =
    `${member?.first_name ?? ''} ${member?.last_name ?? ''}`.trim() || 'Host'

  const now = new Date().toISOString()

  // The member may already own a hosts row created from the GHL host tag
  // (ensureHostRow runs on every login). Adopt it rather than failing on
  // hosts_member_unique — the venues below are the thing it was missing.
  const { data: existingHost } = await admin
    .from('hosts')
    .select('*')
    .eq('member_id', ctx.memberId)
    .maybeSingle()

  // Already a host with venues of their own: nothing here to do, and silently
  // replacing their grant would be worse than saying so.
  if (existingHost?.status === 'active' && !existingHost.venues_unrestricted) {
    const venues = await venuesForHost(admin, existingHost.id)
    if (venues.length > 0) {
      return NextResponse.json({ error: 'You are already a host.' }, { status: 409 })
    }
  }

  // ---- The GHL account, before the role ----------------------
  //
  // A host's venue calendar is staffed by their own GHL user, and every
  // appointment booked at that venue is assigned to it. So it is created first
  // and it is required: a hosts row without one is the half-state this used to
  // leave behind — the role granted here, the bookings falling to
  // GHL_DEFAULT_ASSIGNEE_ID, and somebody having to notice.
  //
  // Reused when the member already has one, which covers the host provisioned
  // from their GHL tag at login, staff, and anyone set up by hand.
  const ghlUserId =
    existingHost?.ghl_user_id?.trim() ||
    (
      await provisionGhlUser(
        {
          first_name: member?.first_name ?? null,
          last_name: member?.last_name ?? null,
          email: member?.email ?? ctx.email,
          phone: member?.phone ?? null,
        },
        hostName,
      )
    )?.userId

  if (!ghlUserId) {
    // Nothing has been written yet, so there is nothing to undo and nothing
    // half-made: the member is still not a host and can submit again. The
    // reason is in the provisioning logs — a missing GHL_COMPANY_ID, a
    // location-scoped token, or GHL refusing the address.
    logger.error('Host not created: GHL user could not be provisioned', {
      action: 'host.become.ghl_user_failed',
      userId: ctx.userId,
      metadata: { venues: grantedVenueIds.length, adopting_existing_host: !!existingHost },
    })
    return NextResponse.json(
      { error: 'We could not set up your host account with our booking system. Please try again.' },
      { status: 502 },
    )
  }

  let host: Host
  if (existingHost) {
    const { data: updated, error: adoptError } = await admin
      .from('hosts')
      .update({
        name: sanitiseText(hostName),
        status: 'active',
        source: 'application',
        ghl_user_id: ghlUserId,
        // The grant below is now the authority on where they may host, so drop
        // any blanket access the tag-provisioned row was carrying.
        venues_unrestricted: false,
        updated_at: now,
      })
      .eq('id', existingHost.id)
      .select()
      .single()

    if (adoptError || !updated) {
      return NextResponse.json(
        { error: adoptError?.message ?? 'Could not set you up as a host.' },
        { status: 500 },
      )
    }
    host = updated as Host
  } else {
    const { data: created, error: hostError } = await admin
      .from('hosts')
      .insert({
        member_id: ctx.memberId,
        name: sanitiseText(hostName),
        created_by: ctx.userId,
        source: 'application',
        ghl_user_id: ghlUserId,
      })
      .select()
      .single()

    if (hostError || !created) {
      return NextResponse.json(
        { error: hostError?.message ?? 'Could not set you up as a host.' },
        { status: 500 },
      )
    }
    host = created as Host
  }

  /**
   * Undo the role on a later failure, without revoking one we didn't grant.
   *
   * ghl_user_id is deliberately left set: that account exists in GHL either
   * way, and forgetting it would only mean creating a second one on the same
   * email next time, which GHL refuses.
   */
  const rollbackHost = async () => {
    if (!existingHost) {
      await admin.from('hosts').delete().eq('id', host.id)
      return
    }
    await admin
      .from('hosts')
      .update({
        name: existingHost.name,
        status: existingHost.status,
        source: existingHost.source,
        venues_unrestricted: existingHost.venues_unrestricted,
      })
      .eq('id', host.id)
  }

  // Grant the venues. This is the authority on where the host may operate, so
  // producing no rows must not read as success — an empty grant used to mean
  // access to every course.
  const priorVenueIds = existingHost ? (await venuesForHost(admin, host.id)).map(v => v.id) : []
  if (priorVenueIds.length) await admin.from('host_venues').delete().eq('host_id', host.id)

  const { error: venuesError } = await admin
    .from('host_venues')
    .insert(grantedVenueIds.map(course_id => ({ host_id: host.id, course_id })))

  if (venuesError) {
    if (priorVenueIds.length) {
      await admin
        .from('host_venues')
        .insert(priorVenueIds.map(course_id => ({ host_id: host.id, course_id })))
    }
    await rollbackHost()
    return NextResponse.json({ error: venuesError.message }, { status: 500 })
  }

  // ---- The rounds they proposed ------------------------------
  //
  // Created straight away, exactly as POST /api/host/events would. Capacity is
  // what the venue actually has open that day — a flat number would oversell
  // the thin days and waste the busy ones. A club we don't have yet has no
  // calendar to ask, so its rounds carry the host's own numbers instead.
  const proposed = Array.isArray(body.events) ? body.events : []
  const kept = proposed
    .map(ev => ({ ev, courseId: String(ev.venue ?? '') }))
    .filter((r): r is { ev: ProposedRoundInput; courseId: string } =>
      !!r.courseId && grantedVenueIds.includes(r.courseId),
    )

  const spotsByCourse = new Map<string, Map<string, number>>()
  for (const courseId of new Set(kept.map(r => r.courseId))) {
    const course = coursesById.get(courseId)
    if (!course || course.approval_status === 'pending') continue
    const dates = kept.filter(r => r.courseId === courseId).map(r => String(r.ev.event_date))
    spotsByCourse.set(courseId, await openSpotsByDate(admin, course, dates))
  }

  const proposedTerms = (ev: ProposedRoundInput) => {
    const spots = Number(ev.total_spots)
    const rate = Number(ev.member_guest_rate)
    return Number.isInteger(spots) && spots >= 1 && Number.isFinite(rate) && rate >= 0
      ? { spots, rate }
      : null
  }

  const today = new Date().toISOString().slice(0, 10)
  const rounds = kept
    .map(({ ev, courseId }) => {
      const pendingCourse = coursesById.get(courseId)?.approval_status === 'pending'
      const terms = pendingCourse ? proposedTerms(ev) : null
      return {
        ev,
        courseId,
        spots: pendingCourse
          ? terms?.spots ?? 0
          : spotsByCourse.get(courseId)?.get(String(ev.event_date)) ?? 0,
        rate: pendingCourse ? terms?.rate ?? HOST_EVENT_GUEST_RATE_USD : HOST_EVENT_GUEST_RATE_USD,
      }
    })
    .filter(r => r.spots > 0 && String(r.ev.event_date) >= today)
    .map(({ ev, courseId, spots, rate }) => ({
      host_id: host.id,
      course_id: courseId,
      event_date: String(ev.event_date),
      tee_time:
        typeof ev.tee_time === 'string' && ev.tee_time.trim()
          ? sanitiseText(ev.tee_time.trim())
          : null,
      total_spots: spots,
      member_guest_rate: rate,
      dinner: ev.dinner === true,
      // Becoming a host grants the role, not the listing. A round still needs a
      // GHL calendar before a member can book it, so it queues behind the same
      // gate as anything a host creates.
      status: 'pending_approval',
    }))

  let createdEvents = 0
  if (rounds.length) {
    const { data: inserted, error: roundsError } = await admin
      .from('hosted_events')
      .insert(rounds)
      .select('id')

    if (roundsError) {
      // Non-fatal: the role and venues are granted, and the host can add the
      // rounds themselves. Losing them silently is what must not happen.
      logger.warn('Could not create the rounds a new host proposed', {
        action: 'host.become.rounds_failed',
        userId: ctx.userId,
        errorMessage: roundsError.message,
        metadata: { host_id: host.id, proposed: rounds.length },
      })
    } else {
      createdEvents = inserted?.length ?? 0
    }
  }

  // ---- The calendars those rounds book against ---------------
  //
  // A round is published against its venue's GHL calendar, so a venue without
  // one can't be opened for booking however quickly it's reviewed. This is the
  // step becoming a host was missing: a club proposed through New LinkUp exists
  // only as a `pending` course with no calendar, and the rounds created above
  // never went through POST /api/host/events — the one path that made it. So
  // nothing did, and the host's first round had nothing to book against.
  //
  // Then the host's availability on it, which is the other half of the same job:
  // a calendar staffed by a brand-new GHL user offers that user's default hours —
  // every weekday, all day — so without this the venue is bookable on hundreds
  // of days the host will never be there.
  //
  // In sequence, not in parallel: createGHLCalendar reads the location's
  // existing calendars to pick a free slug, and two at once would both read the
  // same answer and race for it.
  //
  // Non-fatal, like the venue setup on host event create. The role, the venues
  // and the rounds are the member's; a GHL outage must not take them back.
  let calendarsCreated = 0
  let schedulesWritten = 0
  for (const courseId of grantedVenueIds) {
    const course = coursesById.get(courseId)
    if (!course) continue
    try {
      let calendarId = course.ghl_calendar_id
      if (!calendarId) {
        // This host first so they are the calendar's primary, then anyone else
        // already granted the venue — a venue two hosts share gets both.
        const teamMemberIds = Array.from(
          new Set([ghlUserId, ...(await hostUserIdsForCourse(admin, courseId))]),
        )
        calendarId = await ensureCourseCalendar(admin, course, teamMemberIds)
        if (calendarId) calendarsCreated += 1
      }
      // Run for a venue that already had a calendar too: the rounds created
      // above are new dates on it either way.
      if (!calendarId) continue

      const scheduleId = await syncHostAvailability(admin, {
        hostId: host.id,
        courseId,
        calendarId,
        ghlUserId,
        timezone: course.timezone,
      })
      if (scheduleId) schedulesWritten += 1
    } catch (err) {
      logger.error('Venue calendar setup failed while creating a host', {
        action: 'host.become.calendar_failed',
        userId: ctx.userId,
        errorMessage: String(err),
        metadata: { host_id: host.id, course_id: courseId },
      })
    }
  }

  // Carry the role into GHL. The login gate and the nightly reconcile both work
  // off access tags, so without this an approved host who later loses their
  // golf-membership tag is refused at login while owning a live hosts row.
  if (member?.ghl_contact_id) {
    const tagged = await addTagToContact(member.ghl_contact_id, HOST_ROLE_TAG)
    if (tagged) {
      const currentTags: string[] = member.ghl_tags ?? []
      if (!currentTags.includes(HOST_ROLE_TAG)) {
        await admin
          .from('members')
          .update({ ghl_tags: [...currentTags, HOST_ROLE_TAG] })
          .eq('id', ctx.memberId)
      }
    } else {
      // Non-fatal: the role is the hosts row, not the tag. Logged so the gap is
      // visible rather than silently costing them access later.
      logger.warn('Host created but GHL role tag not applied', {
        action: 'host.become.tag_failed',
        userId: ctx.userId,
        metadata: { host_id: host.id },
      })
    }
  }

  logger.info('Member became a host', {
    action: 'host.become',
    userId: ctx.userId,
    metadata: {
      host_id: host.id,
      adopted_existing_host: !!existingHost,
      venues: grantedVenueIds.length,
      rounds_proposed: proposed.length,
      events_created: createdEvents,
      ghl_user_id: ghlUserId,
      calendars_created: calendarsCreated,
      schedules_written: schedulesWritten,
    },
  })

  return NextResponse.json(
    {
      host,
      venues: await venuesForHost(admin, host.id),
      events_created: createdEvents,
      // No notification: the member is looking at the screen that did it, and
      // the next thing they see is their own host workspace.
    },
    { status: 201 },
  )
})
