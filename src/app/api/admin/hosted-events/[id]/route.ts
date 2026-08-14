export const dynamic = 'force-dynamic'

// POST /api/admin/hosted-events/[id] — admin review of a hosted event.
//   action: 'approve' → publish a pending event to members.
//   action: 'reject'  → take it down (pending or live), with a reason.
//
// A host's event lands in 'pending_approval' and is invisible to members until
// approved, because approving is also when the LinkUp team sets up the GHL
// calendar the event books against. Approve only once that's done — publishing
// an event with no calendar behind it is the failure this gate exists to stop.
//
// Reject cancels rather than returning the event to the host, which is the
// honest description of what happened to anyone already holding a spot. The
// reason is required and shown to the host: they can't fix this one, but they
// can create the event again without whatever was wrong.
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
import {
  APPROVABLE_STATUSES,
  REJECTABLE_STATUSES,
  canApproveEvent,
  canRejectEvent,
} from '@/lib/hosts/events'
import { logger } from '@/lib/logger'
import type { AuthContext } from '@/lib/auth/types'

export const POST = withAuth(
  async (req: NextRequest, ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing event id' }, { status: 400 })

    const body = await req.json().catch(() => ({})) as { action?: string; reason?: string }
    if (body.action !== 'reject' && body.action !== 'approve') {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    const admin = createAdminClient()

    if (body.action === 'approve') {
      return approveEvent(admin, id, ctx)
    }

    const reason = body.reason?.trim() ?? ''
    if (!reason) {
      return NextResponse.json({ error: 'A reason is required — the host sees it.' }, { status: 400 })
    }

    const { data: event } = await admin
      .from('hosted_events')
      // The host's email/name are for the takedown email. The FK is named
      // because hosts references members twice (member_id, created_by) —
      // unnamed, PostgREST rejects the embed as ambiguous.
      .select('id, status, event_date, course:courses(name), host:hosts(member_id, member:members!hosts_member_id_fkey(first_name, email))')
      .eq('id', id)
      .maybeSingle()

    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    if (!canRejectEvent(event.status)) {
      return NextResponse.json(
        { error: 'Only an event that hasn’t run yet can be taken down.' },
        { status: 409 },
      )
    }
    // Only a published event has members holding spots to release; a pending one
    // was never joinable. The distinction changes what we tell people below.
    const wasLive = event.status === 'upcoming'

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
      .in('status', [...REJECTABLE_STATUSES])
      .select('id')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    // Another admin (or the host) moved it in the race window.
    if (!rejected || rejected.length === 0) {
      return NextResponse.json(
        { error: 'Only an event that hasn’t run yet can be taken down.' },
        { status: 409 },
      )
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

    return NextResponse.json({
      ok: true,
      status: 'cancelled',
      released: memberIds.length,
      was_live: wasLive,
    })
  },
  { requireAdmin: true, skipGHLCheck: true }
)

/**
 * Publishes a pending event: this is the moment members can first see it.
 *
 * Approving is a statement that the GHL calendar behind the event exists and
 * the host is on it. Nothing here checks that — it can't, the setup is manual
 * work in another system — so the guard is that only an admin can call it.
 */
async function approveEvent(
  admin: ReturnType<typeof createAdminClient>,
  id: string,
  ctx: AuthContext,
) {
  const { data: event } = await admin
    .from('hosted_events')
    .select('id, status, event_date, course:courses(name), host:hosts(member_id)')
    .eq('id', id)
    .maybeSingle()

  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

  const allowed = canApproveEvent(event.status, event.event_date)
  if (!allowed.ok) {
    return NextResponse.json(
      {
        error: allowed.reason === 'past_date'
          // Publishing a round whose date has gone would put something in member
          // browse that can't be attended. A takedown is the way out, not a retry.
          ? 'That date has passed — take the event down instead.'
          : 'Only an event awaiting approval can be published.',
      },
      { status: 409 },
    )
  }

  // The status filter is the race guard: two admins clicking approve, or a host
  // cancelling mid-review, and only one update finds a row.
  const { data: published, error } = await admin
    .from('hosted_events')
    .update({
      status: 'upcoming',
      reviewed_by: ctx.userId,
      reviewed_at: new Date().toISOString(),
      // A previous rejection reason would be stale the moment it's published.
      rejection_reason: null,
    })
    .eq('id', id)
    .in('status', [...APPROVABLE_STATUSES])
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!published || published.length === 0) {
    return NextResponse.json(
      { error: 'Only an event awaiting approval can be published.' },
      { status: 409 },
    )
  }

  const course = Array.isArray(event.course) ? event.course[0] : event.course
  const host = Array.isArray(event.host) ? event.host[0] : event.host
  const courseName = course?.name ?? 'a course'

  // The host has been waiting on this — it's the difference between "submitted"
  // and "members can book it".
  if (host?.member_id) {
    void sendPushToMember(
      host.member_id,
      NotificationTemplates.hostedEventApproved(courseName, event.event_date)
    ).catch(() => {})
  }

  try {
    await admin.from('admin_audit_log').insert({
      admin_id: ctx.userId,
      action: 'hosted_events.approved',
      target_type: 'hosted_event',
      target_id: id,
      payload: { course: courseName, event_date: event.event_date },
    })
  } catch { /* table may not exist yet */ }

  logger.info('Hosted event approved by admin', {
    action: 'admin.hosted_event.approved',
    userId: ctx.userId,
    metadata: { event_id: id },
  })

  return NextResponse.json({ ok: true, status: 'upcoming' })
}
