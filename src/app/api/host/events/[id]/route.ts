export const dynamic = 'force-dynamic'

// GET   /api/host/events/[id] — one of the caller's events, with registrations
//         and proofs.
// PATCH /api/host/events/[id] — action: 'update' | 'publish' | 'cancel'.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withHostAuth, type HostAuthContext } from '@/lib/auth/with-host-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { validateHostedEventPayload, sanitiseText } from '@/lib/validation'
import { enrichHostedEvents } from '@/lib/hosts/events'
import { sendPushToMembers, NotificationTemplates } from '@/lib/push'
import { logger } from '@/lib/logger'
import type { HostedEvent } from '@/types'

const todayISO = () => new Date().toISOString().slice(0, 10)

// A host may still change an event that hasn't happened yet.
const EDITABLE_STATUSES = ['draft', 'upcoming']
const CANCELLABLE_STATUSES = ['draft', 'upcoming']

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

    return NextResponse.json({ event: { ...enriched, proofs: proofs ?? [] }, registrations: registrations ?? [] })
  }
)

export const PATCH = withHostAuth(
  async (req: NextRequest, ctx: HostAuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing event id' }, { status: 400 })

    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const action = body.action
    if (action !== 'update' && action !== 'publish' && action !== 'cancel') {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    const admin = createAdminClient()
    const event = await loadOwnEvent(admin, id, ctx.host.id)
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

    // ---- Publish (draft -> upcoming) -------------------------
    // No admin review gate: publishing takes the event live immediately.
    if (action === 'publish') {
      if (event.status !== 'draft') {
        return NextResponse.json({ error: 'Only a draft can be published.' }, { status: 409 })
      }
      if (event.event_date < todayISO()) {
        return NextResponse.json({ error: 'Set a future date before publishing.' }, { status: 400 })
      }
      const { data: published, error } = await admin
        .from('hosted_events')
        .update({ status: 'upcoming', rejection_reason: null })
        .eq('id', id).eq('status', 'draft')
        .select('id')
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      if (!published || published.length === 0) {
        return NextResponse.json({ error: 'This event is no longer a draft.' }, { status: 409 })
      }

      logger.info('Hosted event published', {
        action: 'host.event.published', userId: ctx.userId, metadata: { event_id: id },
      })
      return NextResponse.json({ ok: true, status: 'upcoming' })
    }

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

    // Changing the course is allowed while editable, but must stay a bookable course.
    if ('course_id' in body) {
      const { data: course } = await admin
        .from('courses').select('id, approval_status').eq('id', body.course_id as string).maybeSingle()
      if (!course || course.approval_status !== 'active') {
        return NextResponse.json({ error: 'That course is not available for events.' }, { status: 400 })
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
