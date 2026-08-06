export const dynamic = 'force-dynamic'

// POST /api/admin/hosted-events/[id] — admin review of a live hosted event.
//   action: 'reject' → take a published event down.
//
// Events publish without waiting for approval, so this is the counterweight: an
// admin who sees an event that shouldn't be listed takes it down. There is no
// draft to send it back to — the event is cancelled, which is also the honest
// description of what happened to anyone holding a spot in it. The reason is
// still required, and still shown to the host: they can't fix this one, but
// they can create the event again without it.
//
// Credit approval after the event has run is a separate decision and lives in
// ./[id]/credits.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { sanitiseText } from '@/lib/validation'
import { sendPushToMember, sendPushToMembers, NotificationTemplates } from '@/lib/push'
import { triggerHostedEventTakedownWebhook } from '@/lib/ghl/client'
import { logger } from '@/lib/logger'
import type { AuthContext } from '@/lib/auth/types'

// Only a live listing can be taken down. An event that has run (completed /
// pending_credit_approval / credits_awarded) happened — taking it down would
// rewrite history rather than prevent it.
const REJECTABLE_STATUSES = ['upcoming']

export const POST = withAuth(
  async (req: NextRequest, ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing event id' }, { status: 400 })

    const body = await req.json().catch(() => ({})) as { action?: string; reason?: string }
    if (body.action !== 'reject') {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    const reason = body.reason?.trim() ?? ''
    if (!reason) {
      return NextResponse.json({ error: 'A reason is required — the host sees it.' }, { status: 400 })
    }

    const admin = createAdminClient()

    const { data: event } = await admin
      .from('hosted_events')
      // The host's email/name are for the takedown email. The FK is named
      // because hosts references members twice (member_id, created_by) —
      // unnamed, PostgREST rejects the embed as ambiguous.
      .select('id, status, event_date, course:courses(name), host:hosts(member_id, member:members!hosts_member_id_fkey(first_name, email))')
      .eq('id', id)
      .maybeSingle()

    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    if (!REJECTABLE_STATUSES.includes(event.status)) {
      return NextResponse.json({ error: 'Only a live event can be taken down.' }, { status: 409 })
    }

    // Capture who holds a spot before we release them.
    const { data: reserved } = await admin
      .from('hosted_event_registrations')
      .select('member_id')
      .eq('hosted_event_id', id)
      .eq('status', 'reserved')

    // rejection_reason rather than cancellation_reason: both end at 'cancelled',
    // and the column is what tells the two apart afterwards — a host calling
    // their own event off reads very differently from an admin pulling it.
    const { data: rejected, error } = await admin
      .from('hosted_events')
      .update({
        status: 'cancelled',
        rejection_reason: sanitiseText(reason),
        reviewed_by: ctx.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', id)
      .in('status', REJECTABLE_STATUSES)
      .select('id')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    // Another admin (or the host) moved it in the race window.
    if (!rejected || rejected.length === 0) {
      return NextResponse.json({ error: 'Only a live event can be taken down.' }, { status: 409 })
    }

    // A cancelled event isn't joinable, so nobody may keep a spot in it.
    await admin
      .from('hosted_event_registrations')
      .update({ status: 'cancelled' })
      .eq('hosted_event_id', id)
      .eq('status', 'reserved')

    const course = Array.isArray(event.course) ? event.course[0] : event.course
    const host = Array.isArray(event.host) ? event.host[0] : event.host
    const hostMember = Array.isArray(host?.member) ? host?.member[0] : host?.member
    const courseName = course?.name ?? 'a course'

    // Members who had reserved lose their spot — same message the host's own
    // cancellation sends, because from the member's side it's the same outcome.
    const memberIds = (reserved ?? []).map(r => r.member_id)

    if (host?.member_id) {
      void sendPushToMember(
        host.member_id,
        NotificationTemplates.hostedEventRejected(courseName, event.event_date, reason)
      ).catch(() => {})
    }

    // The same news by email, via a GHL workflow. A push is easy to miss and
    // easy to have turned off, and losing your event is not something to find
    // out about by opening the app. Best-effort and fire-and-forget like the
    // push: the takedown has already happened, and a GHL hiccup must not turn a
    // completed action into a failed request.
    //
    // No-ops until the GHL workflow exists — see
    // GHL_HOSTED_EVENT_TAKEDOWN_WEBHOOK_PATH.
    if (hostMember?.email) {
      void triggerHostedEventTakedownWebhook({
        firstName: hostMember.first_name ?? '',
        email: hostMember.email,
        courseName,
        eventDate: event.event_date,
        reason,
        releasedCount: memberIds.length,
      }).catch(() => {})
    }

    if (memberIds.length) {
      void sendPushToMembers(
        memberIds,
        NotificationTemplates.hostedEventCancelled(courseName, event.event_date)
      ).catch(() => {})
    }

    logger.info('Hosted event rejected by admin', {
      action: 'admin.hosted_event.rejected',
      userId: ctx.userId,
      metadata: { event_id: id, released: memberIds.length },
    })

    return NextResponse.json({ ok: true, status: 'cancelled', released: memberIds.length })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
