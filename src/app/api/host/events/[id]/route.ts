export const dynamic = 'force-dynamic'

// GET   /api/host/events/[id] — one of the caller's events, with registrations
//         and proofs.
// PATCH /api/host/events/[id] — action: 'update' | 'cancel'.
//
// There is no 'publish' action: an event is live from the moment it's created,
// so the only states a host can move it to are edited or cancelled.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withHostAuth, type HostAuthContext } from '@/lib/auth/with-host-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { validateHostedEventPayload, sanitiseText } from '@/lib/validation'
import { enrichHostedEvents, hostCanUseCourse } from '@/lib/hosts/events'
import { sendPushToMembers, NotificationTemplates } from '@/lib/push'
import { logger } from '@/lib/logger'
import type { HostedEvent } from '@/types'

const todayISO = () => new Date().toISOString().slice(0, 10)

// A host may still change an event that hasn't happened yet — including one
// still waiting on approval, which is exactly when a mistake is cheapest to fix.
const EDITABLE_STATUSES = ['pending_approval', 'upcoming']
const CANCELLABLE_STATUSES = ['pending_approval', 'upcoming']

// Fields that come from the linked booking and therefore can't be edited.
const BOOKING_LOCKED_FIELDS = ['course_id', 'event_date', 'tee_time']

// Cancelled / waitlisted rows don't hold a seat — same rule as the capacity RPCs.
const ACTIVE_BOOKING_STATUSES = [
  'tentative', 'awaiting_approval', 'availability_confirmed',
  'payment_confirmed', 'confirmed', 'pending',
]

async function loadOwnEvent(admin: ReturnType<typeof createAdminClient>, id: string, hostId: string) {
  const { data } = await admin
    .from('hosted_events')
    .select('*, course:courses(id, name)')
    .eq('id', id)
    .eq('host_id', hostId)
    .maybeSingle()
  return data as HostedEvent | null
}

export const GET = withHostAuth(
  async (_req: NextRequest, ctx: HostAuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing event id' }, { status: 400 })

    const admin = createAdminClient()
    const event = await loadOwnEvent(admin, id, ctx.host.id)
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

    const [enriched] = await enrichHostedEvents(admin, [event])

    // avatar_url lives on member_profiles, not members — asking members for it
    // makes PostgREST reject the whole query, which then reads as "nobody has
    // registered". The FK is named even though this table references members
    // once today, since an added column would silently make it ambiguous.
    const { data: registrationRows, error: registrationsError } = await admin
      .from('hosted_event_registrations')
      .select('*, member:members!hosted_event_registrations_member_id_fkey(first_name, last_name, profile:member_profiles(avatar_url))')
      .eq('hosted_event_id', id)
      .eq('status', 'reserved')
      .order('created_at', { ascending: true })

    // Surface it rather than rendering a failed query as an empty roster.
    if (registrationsError) {
      return NextResponse.json({ error: registrationsError.message }, { status: 500 })
    }

    // Flatten the nested profile so the client keeps a flat member shape.
    const registrations = (registrationRows ?? []).map(r => {
      const m = r.member as unknown as {
        first_name: string
        last_name: string
        profile: { avatar_url: string | null } | { avatar_url: string | null }[] | null
      } | null
      const profile = Array.isArray(m?.profile) ? m?.profile[0] : m?.profile
      return {
        ...r,
        member: m ? { first_name: m.first_name, last_name: m.last_name, avatar_url: profile?.avatar_url ?? null } : null,
      }
    })

    const { data: proofs } = await admin
      .from('hosted_event_proofs')
      .select('*')
      .eq('hosted_event_id', id)
      .order('created_at', { ascending: false })

    // Members who booked the venue that day are at this round too — the same
    // afternoon at the same club — so the roster is both, not just the people
    // who happened to come through the event. Anyone holding both is listed
    // once, as a reservation, since that is the more specific commitment.
    const reservedIds = new Set(registrations.map(r => r.member_id as string))
    const alsoBooked = (enriched?.booked_attendees ?? [])
      .filter(a => !reservedIds.has(a.member_id))
      .map(a => ({
        id: `booking:${a.member_id}`,
        hosted_event_id: id,
        member_id: a.member_id,
        status: 'reserved' as const,
        // Not a reservation row, so it has no created_at of its own. The
        // client uses `source` to say how they got here.
        created_at: null,
        source: 'booking' as const,
        tee_time: a.tee_time,
        member: {
          first_name: a.first_name,
          last_name: a.last_name,
          avatar_url: a.avatar_url,
        },
      }))

    const roster = [
      ...registrations.map(r => ({ ...r, source: 'reservation' as const })),
      ...alsoBooked,
    ]

    return NextResponse.json({
      event: { ...enriched, proofs: proofs ?? [] },
      // `registrations` keeps its name for the client that reads it.
      registrations: roster,
    })
  }
)

export const PATCH = withHostAuth(
  async (req: NextRequest, ctx: HostAuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing event id' }, { status: 400 })

    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const action = body.action
    if (action !== 'update' && action !== 'cancel') {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    const admin = createAdminClient()
    const event = await loadOwnEvent(admin, id, ctx.host.id)
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

    // ---- Cancel ----------------------------------------------
    if (action === 'cancel') {
      if (!EDITABLE_STATUSES.includes(event.status)) {
        return NextResponse.json({ error: 'This event can no longer be cancelled.' }, { status: 409 })
      }
      const reason = typeof body.cancellation_reason === 'string' ? body.cancellation_reason.trim() : ''

      // Who to notify — capture reserved members before we free them.
      const { data: reserved } = await admin
        .from('hosted_event_registrations')
        .select('member_id')
        .eq('hosted_event_id', id)
        .eq('status', 'reserved')

      const { data: cancelledRows, error } = await admin
        .from('hosted_events')
        .update({ status: 'cancelled', cancellation_reason: reason ? sanitiseText(reason) : null })
        .eq('id', id)
        .in('status', CANCELLABLE_STATUSES)
        .select('id')
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      if (!cancelledRows || cancelledRows.length === 0) {
        return NextResponse.json({ error: 'This event can no longer be cancelled.' }, { status: 409 })
      }

      // Free everyone who had reserved a spot.
      await admin
        .from('hosted_event_registrations')
        .update({ status: 'cancelled' })
        .eq('hosted_event_id', id)
        .eq('status', 'reserved')

      // Tell the released members (best-effort).
      const memberIds = (reserved ?? []).map(r => r.member_id)
      if (memberIds.length) {
        void sendPushToMembers(
          memberIds,
          NotificationTemplates.hostedEventCancelled(event.course?.name ?? 'a course', event.event_date, reason || undefined)
        ).catch(() => {})
      }

      logger.info('Hosted event cancelled', {
        action: 'host.event.cancelled', userId: ctx.userId, metadata: { event_id: id, notified: memberIds.length },
      })
      return NextResponse.json({ ok: true, status: 'cancelled' })
    }

    // ---- Update ----------------------------------------------
    if (!EDITABLE_STATUSES.includes(event.status)) {
      return NextResponse.json({ error: 'This event can no longer be edited.' }, { status: 409 })
    }

    const { valid, errors } = validateHostedEventPayload(body, { partial: true })
    if (!valid) return NextResponse.json({ error: errors[0] }, { status: 400 })

    // An event listed from a booking takes its course/date/tee time from that
    // booking — changing them here would let it drift from the real tee time.
    if (event.source_booking_id) {
      const attempted = BOOKING_LOCKED_FIELDS.filter(f => f in body)
      if (attempted.length) {
        return NextResponse.json(
          { error: 'This event is linked to a booking — its course, date, and tee time can\'t be changed.' },
          { status: 409 }
        )
      }
    }

    const patch: Record<string, unknown> = {}
    if ('event_date' in body) {
      if (String(body.event_date) < todayISO()) {
        return NextResponse.json({ error: 'Event date cannot be in the past.' }, { status: 400 })
      }
      patch.event_date = String(body.event_date)
    }
    if ('tee_time' in body) {
      patch.tee_time = typeof body.tee_time === 'string' && body.tee_time.trim()
        ? sanitiseText(body.tee_time.trim())
        : null
    }
    if ('member_guest_rate' in body) patch.member_guest_rate = Number(body.member_guest_rate)
    if ('dinner' in body) patch.dinner = body.dinner === true

    if ('total_spots' in body) {
      const nextSpots = Number(body.total_spots)
      // Can't shrink capacity below the number already reserved.
      const { count } = await admin
        .from('hosted_event_registrations')
        .select('id', { count: 'exact', head: true })
        .eq('hosted_event_id', id)
        .eq('status', 'reserved')
      if ((count ?? 0) > nextSpots) {
        return NextResponse.json(
          { error: `${count} members have already reserved — spots can't be set below that.` },
          { status: 409 }
        )
      }

      // Nor grow it beyond the seats the linked booking actually holds.
      if (event.source_booking_id) {
        const { data: src } = await admin
          .from('bookings')
          .select('member_id, created_at, booking_date, tee_time, course_id')
          .eq('id', event.source_booking_id)
          .maybeSingle()
        if (src) {
          const { count: seats } = await admin
            .from('bookings')
            .select('id', { count: 'exact', head: true })
            // Counted against whoever made the booking, not the host.
            .eq('member_id', src.member_id)
            .eq('created_at', src.created_at)
            .eq('booking_date', src.booking_date)
            .eq('tee_time', src.tee_time)
            .eq('course_id', src.course_id)
            .in('status', ACTIVE_BOOKING_STATUSES)
          if (seats != null && nextSpots > seats) {
            return NextResponse.json(
              { error: `That booking holds ${seats} seat${seats === 1 ? '' : 's'} — you can't offer more than that.` },
              { status: 400 }
            )
          }
        }
      }

      patch.total_spots = nextSpots
    }

    // Changing the course is allowed while editable, but must stay a bookable
    // course the host is approved to use. Only enforce the venue rule when the
    // course actually changes, so editing other fields on an event whose course
    // predates the host's venue list isn't blocked. (Booking-linked events can't
    // reach here — course_id is a locked field, rejected above.)
    if ('course_id' in body && body.course_id !== event.course_id) {
      const { data: course } = await admin
        .from('courses').select('id, approval_status').eq('id', body.course_id as string).maybeSingle()
      if (!course) {
        return NextResponse.json({ error: 'That course is not available for events.' }, { status: 400 })
      }
      if (!(await hostCanUseCourse(admin, ctx.host.id, course.id))) {
        return NextResponse.json({ error: 'You can only host events at your approved venues.' }, { status: 400 })
      }
      // Same rule as create: a pending course is usable only as an explicitly
      // granted venue. Otherwise a host could create an event at the club they
      // proposed but never move an event onto it.
      if (course.approval_status !== 'active') {
        const { data: grantedVenue } = await admin
          .from('host_venues')
          .select('course_id')
          .eq('host_id', ctx.host.id)
          .eq('course_id', course.id)
          .maybeSingle()
        if (course.approval_status !== 'pending' || !grantedVenue) {
          return NextResponse.json({ error: 'That course is not available for events.' }, { status: 400 })
        }
      }
      patch.course_id = course.id
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
    }

    const { data: updated, error } = await admin
      .from('hosted_events')
      .update(patch)
      .eq('id', id)
      .in('status', EDITABLE_STATUSES)
      .select('*, course:courses(id, name)')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const [enriched] = await enrichHostedEvents(admin, [updated as HostedEvent])

    // If a material detail changed on a live event, tell the members who
    // reserved (best-effort). Description / spot changes don't warrant a ping.
    const MATERIAL = ['event_date', 'tee_time', 'course_id', 'member_guest_rate']
    if (event.status === 'upcoming' && MATERIAL.some(k => k in patch)) {
      const { data: reserved } = await admin
        .from('hosted_event_registrations')
        .select('member_id')
        .eq('hosted_event_id', id)
        .eq('status', 'reserved')
      const memberIds = (reserved ?? []).map(r => r.member_id)
      if (memberIds.length) {
        void sendPushToMembers(
          memberIds,
          NotificationTemplates.hostedEventUpdated(
            enriched?.course?.name ?? event.course?.name ?? 'a course',
            enriched?.event_date ?? event.event_date
          )
        ).catch(() => {})
      }
    }

    logger.info('Hosted event updated', {
      action: 'host.event.updated', userId: ctx.userId, metadata: { event_id: id },
    })
    return NextResponse.json({ event: enriched })
  }
)
