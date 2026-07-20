export const dynamic = 'force-dynamic'

// POST   /api/hosted-events/[id]/register — reserve a spot (race-safe via the
//          reserve_hosted_event_spot RPC).
// DELETE  /api/hosted-events/[id]/register — cancel the caller's own spot.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { sendPushToMember, NotificationTemplates } from '@/lib/push'
import { logger } from '@/lib/logger'
import type { AuthContext } from '@/lib/auth/types'

export const POST = withAuth(
  async (_req: NextRequest, ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing event id' }, { status: 400 })

    const admin = createAdminClient()

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
      void sendPushToMember(
        host.member_id,
        NotificationTemplates.hostedEventJoined(memberName, course?.name ?? 'your event', event?.event_date ?? '')
      ).catch(() => {})
    }

    logger.info('Hosted event reservation created', {
      action: 'hosted_event.registered',
      userId: ctx.userId,
      metadata: { event_id: id },
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
      .from('hosted_events').select('status').eq('id', id).maybeSingle()
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    if (event.status !== 'upcoming') {
      return NextResponse.json({ error: 'This event can no longer be changed.' }, { status: 409 })
    }

    const { data: updated, error } = await admin
      .from('hosted_event_registrations')
      .update({ status: 'cancelled' })
      .eq('hosted_event_id', id)
      .eq('member_id', ctx.memberId)
      .eq('status', 'reserved')
      .select('id')

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: 'You don\'t have a spot to cancel.' }, { status: 404 })
    }

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
      void sendPushToMember(
        host.member_id,
        NotificationTemplates.hostedEventMemberCancelled(memberName, course?.name ?? 'your event', full?.event_date ?? '')
      ).catch(() => {})
    }

    logger.info('Hosted event reservation cancelled', {
      action: 'hosted_event.unregistered',
      userId: ctx.userId,
      metadata: { event_id: id },
    })

    return NextResponse.json({ ok: true })
  }
)
