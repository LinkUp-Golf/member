export const dynamic = 'force-dynamic'

// POST /api/admin/hosted-events/[id]/review — approve or reject an event a host
// submitted. Approving makes it visible to members (pending_review -> upcoming);
// rejecting sends it back to draft with a reason so the host can fix and
// resubmit. This is separate from credit approval, which happens after the
// event has taken place.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { sanitiseText } from '@/lib/validation'
import { sendPushToMember, NotificationTemplates } from '@/lib/push'
import { logger } from '@/lib/logger'
import type { AuthContext } from '@/lib/auth/types'

export const POST = withAuth(
  async (req: NextRequest, ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing event id' }, { status: 400 })

    const body = await req.json().catch(() => ({})) as { action?: 'approve' | 'reject'; reason?: string }
    if (body.action !== 'approve' && body.action !== 'reject') {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    const admin = createAdminClient()

    const { data: event } = await admin
      .from('hosted_events')
      .select('id, status, event_date, course:courses(name), host:hosts(member_id)')
      .eq('id', id)
      .maybeSingle()

    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    if (event.status !== 'pending_review') {
      return NextResponse.json({ error: 'This event is not awaiting review.' }, { status: 409 })
    }

    const host = Array.isArray(event.host) ? event.host[0] : event.host
    const course = Array.isArray(event.course) ? event.course[0] : event.course
    const reviewedAt = new Date().toISOString()

    // ---- Reject → back to draft ------------------------------
    if (body.action === 'reject') {
      const reason = body.reason?.trim() ?? ''
      if (!reason) return NextResponse.json({ error: 'A reason is required' }, { status: 400 })

      const { data: rejected, error } = await admin
        .from('hosted_events')
        .update({
          status: 'draft',
          rejection_reason: sanitiseText(reason),
          reviewed_by: ctx.userId,
          reviewed_at: reviewedAt,
        })
        .eq('id', id)
        .eq('status', 'pending_review')
        .select('id')

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      // 0 rows means another admin reviewed it in the race window.
      if (!rejected || rejected.length === 0) {
        return NextResponse.json({ error: 'This event is not awaiting review.' }, { status: 409 })
      }

      if (host?.member_id) {
        void sendPushToMember(host.member_id, NotificationTemplates.hostedEventRejected(reason)).catch(() => {})
      }
      logger.info('Hosted event rejected in review', {
        action: 'host.event.review.rejected', userId: ctx.userId, metadata: { event_id: id },
      })
      return NextResponse.json({ ok: true, status: 'draft' })
    }

    // ---- Approve → live for members --------------------------
    const { data: approved, error } = await admin
      .from('hosted_events')
      .update({
        status: 'upcoming',
        rejection_reason: null,
        reviewed_by: ctx.userId,
        reviewed_at: reviewedAt,
      })
      .eq('id', id)
      .eq('status', 'pending_review')
      .select('id')

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!approved || approved.length === 0) {
      return NextResponse.json({ error: 'This event is not awaiting review.' }, { status: 409 })
    }

    if (host?.member_id) {
      void sendPushToMember(
        host.member_id,
        NotificationTemplates.hostedEventApproved(course?.name ?? 'your course', event.event_date)
      ).catch(() => {})
    }

    logger.info('Hosted event approved in review', {
      action: 'host.event.review.approved', userId: ctx.userId, metadata: { event_id: id },
    })

    return NextResponse.json({ ok: true, status: 'upcoming' })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
