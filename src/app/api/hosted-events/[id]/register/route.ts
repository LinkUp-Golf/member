export const dynamic = 'force-dynamic'

// POST   /api/hosted-events/[id]/register — reserve a spot (race-safe via the
//          reserve_hosted_event_spot RPC). Needs a card on file while the
//          cancellation policy is on, like booking a venue does.
// DELETE  /api/hosted-events/[id]/register — cancel the caller's own spot. Inside
//          the cancellation window that costs a share of the round's member
//          price, charged to the card on file (`fee` in the response).

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { NotificationTemplates } from '@/lib/push'
import { notifyMember } from '@/lib/notify'
import { logger } from '@/lib/logger'
import { logActivity } from '@/lib/activity/log'
import { needsCardOnFile } from '@/lib/stripe/cards'
import { stripeEnabled } from '@/lib/stripe/client'
import { CARD_REQUIRED_CODE, CARD_REQUIRED_MESSAGE } from '@/lib/stripe/card'
import { cancellationQuote, todayAtVenue } from '@/lib/cancellation/policy'
import {
  collectCancellationFee,
  discardCancellationFee,
  recordCancellationFee,
} from '@/lib/cancellation/fees'
import { memberPrice } from '@/lib/hosts/events'
import { AVIARA_TIMEZONE } from '@/lib/constants'
import type { AuthContext } from '@/lib/auth/types'
import type { CancellationFee } from '@/types'

export const POST = withAuth(
  async (_req: NextRequest, ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing event id' }, { status: 400 })

    const admin = createAdminClient()

    // A suspended host's events are hidden from browse, but the id may still be
    // held in an open tab, a push notification or a bookmark — so the gate has to
    // be here too, not only in the listing query.
    const { data: eventHost } = await admin
      .from('hosted_events')
      .select('host:hosts!inner(status)')
      .eq('id', id)
      .maybeSingle()
    const hostRow = Array.isArray(eventHost?.host) ? eventHost?.host[0] : eventHost?.host
    if (hostRow && hostRow.status !== 'active') {
      return NextResponse.json({ error: 'This event isn\'t open for reservations.' }, { status: 409 })
    }

    // The seat comes under the cancellation policy, so it needs a card to
    // charge if it's given up late — the same gate POST /api/bookings/create has.
    if (await needsCardOnFile(admin, ctx.memberId)) {
      return NextResponse.json({ error: CARD_REQUIRED_MESSAGE, code: CARD_REQUIRED_CODE }, { status: 409 })
    }

    const { error } = await admin.rpc('reserve_hosted_event_spot', {
      p_event_id: id,
      p_member_id: ctx.memberId,
    })

    if (error) {
      // P0001 contract from the function.
      const msg = error.message ?? ''
      if (msg.startsWith('EVENT_NOT_OPEN')) {
        return NextResponse.json({ error: 'This event isn\'t open for reservations.' }, { status: 409 })
      }
      if (msg.startsWith('ALREADY_REGISTERED')) {
        return NextResponse.json({ error: 'You already have a spot at this event.' }, { status: 409 })
      }
      if (msg.startsWith('EVENT_FULL')) {
        return NextResponse.json({ error: 'This event is full.' }, { status: 409 })
      }
      return NextResponse.json({ error: msg || 'Could not reserve a spot.' }, { status: 500 })
    }

    // Notify the host of the new reservation (best-effort).
    const { data: event } = await admin
      .from('hosted_events')
      .select('event_date, course:courses(name), host:hosts(member_id)')
      .eq('id', id)
      .maybeSingle()
    const { data: member } = await admin
      .from('members')
      .select('first_name, last_name')
      .eq('id', ctx.memberId)
      .maybeSingle()

    const host = Array.isArray(event?.host) ? event?.host[0] : event?.host
    const course = Array.isArray(event?.course) ? event?.course[0] : event?.course
    if (host?.member_id) {
      const memberName = `${member?.first_name ?? ''} ${member?.last_name ?? ''}`.trim() || 'A member'
      void notifyMember(
        host.member_id,
        NotificationTemplates.hostedEventJoined(memberName, course?.name ?? 'your event', event?.event_date ?? '')
      ).catch(() => {})
    }

    logger.info('Hosted event reservation created', {
      action: 'hosted_event.registered',
      userId: ctx.userId,
      metadata: { event_id: id },
    })

    void logActivity({
      memberId: ctx.memberId,
      action: 'hosted_event_registered',
      courseId: ctx.homeCourseId,
      targetId: id,
      targetLabel: course?.name ?? null,
      path: `/more/hosted-events/${id}`,
    })

    return NextResponse.json({ ok: true }, { status: 201 })
  }
)

export const DELETE = withAuth(
  async (_req: NextRequest, ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing event id' }, { status: 400 })

    const admin = createAdminClient()

    // Only an active reservation on a still-open event can be cancelled by the
    // member; once the event is over it's part of the record.
    const { data: event } = await admin
      .from('hosted_events')
      .select('status, event_date, tee_time, member_guest_rate, course_id, course:courses(name, timezone)')
      .eq('id', id)
      .maybeSingle()
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    if (event.status !== 'upcoming') {
      return NextResponse.json({ error: 'This event can no longer be changed.' }, { status: 409 })
    }

    const { data: registration } = await admin
      .from('hosted_event_registrations')
      .select('id, cancellation_policy_applies')
      .eq('hosted_event_id', id)
      .eq('member_id', ctx.memberId)
      .eq('status', 'reserved')
      .maybeSingle()
    if (!registration) {
      return NextResponse.json({ error: 'You don\'t have a spot to cancel.' }, { status: 404 })
    }

    // Recorded before the spot is released — see @/lib/cancellation/fees.
    let fee: CancellationFee | null = null
    const eventCourse = Array.isArray(event.course) ? event.course[0] : event.course
    if (stripeEnabled() && registration.cancellation_policy_applies === true) {
      const quote = cancellationQuote({
        price: memberPrice(Number(event.member_guest_rate) || 0),
        eventDate: event.event_date,
        today: todayAtVenue(eventCourse?.timezone || AVIARA_TIMEZONE),
      })
      if (quote.amount > 0) {
        const recorded = await recordCancellationFee(admin, {
          memberId: ctx.memberId,
          source: 'hosted_event',
          hostedEventId: id,
          registrationId: registration.id,
          courseId: event.course_id ?? null,
          courseName: eventCourse?.name ?? null,
          eventDate: event.event_date,
          teeTime: event.tee_time ?? null,
          quote,
        })
        if ('duplicate' in recorded) {
          return NextResponse.json({ error: 'This spot is already being cancelled.' }, { status: 409 })
        }
        if ('error' in recorded) {
          return NextResponse.json({ error: 'Could not cancel your spot. Try again.' }, { status: 500 })
        }
        fee = recorded.fee
      }
    }

    const { data: updated, error } = await admin
      .from('hosted_event_registrations')
      .update({ status: 'cancelled' })
      .eq('id', registration.id)
      .eq('status', 'reserved')
      .select('id')

    if (error || !updated || updated.length === 0) {
      if (fee) await discardCancellationFee(admin, fee.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ error: 'You don\'t have a spot to cancel.' }, { status: 404 })
    }

    const feeOutcome = fee ? await collectCancellationFee(admin, fee) : null

    // Let the host know a spot opened back up (best-effort), mirroring the
    // notification they get when someone reserves.
    const { data: full } = await admin
      .from('hosted_events')
      .select('event_date, course:courses(name), host:hosts(member_id)')
      .eq('id', id)
      .maybeSingle()
    const { data: member } = await admin
      .from('members')
      .select('first_name, last_name')
      .eq('id', ctx.memberId)
      .maybeSingle()

    const host = Array.isArray(full?.host) ? full?.host[0] : full?.host
    const course = Array.isArray(full?.course) ? full?.course[0] : full?.course
    if (host?.member_id) {
      const memberName = `${member?.first_name ?? ''} ${member?.last_name ?? ''}`.trim() || 'A member'
      void notifyMember(
        host.member_id,
        NotificationTemplates.hostedEventMemberCancelled(memberName, course?.name ?? 'your event', full?.event_date ?? '')
      ).catch(() => {})
    }

    logger.info('Hosted event reservation cancelled', {
      action: 'hosted_event.unregistered',
      userId: ctx.userId,
      metadata: { event_id: id },
    })

    return NextResponse.json({ ok: true, fee: feeOutcome })
  }
)
