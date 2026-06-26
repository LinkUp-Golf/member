export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { formatBookingDate } from '@/lib/utils'
import type { AuthContext } from '@/lib/auth/types'

const VALID_STATUSES = new Set(['published', 'rejected', 'pending_review'])

export const PATCH = withAuth(
  async (req: NextRequest, ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing event id' }, { status: 400 })

    const body = await req.json() as { status: string }
    if (!body.status || !VALID_STATUSES.has(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    const admin = createAdminClient()

    const { data: event, error: fetchError } = await admin
      .from('member_events')
      .select('id, title, description, event_date, event_time, location, organizer_id, course_id, status')
      .eq('id', id)
      .single()

    if (fetchError || !event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }

    await admin
      .from('member_events')
      .update({ status: body.status, reviewed_by: ctx.userId })
      .eq('id', id)

    // When approving: create a community announcement via admin client (bypasses RLS author_id check)
    if (body.status === 'published' && event.status !== 'published') {
      const { data: organizer } = await admin
        .from('members')
        .select('first_name, last_name')
        .eq('id', event.organizer_id)
        .single()

      const organizerName = organizer
        ? `${organizer.first_name} ${organizer.last_name}`
        : 'A member'

      await admin.from('announcements').insert({
        course_id: event.course_id,
        author_id: event.organizer_id,
        type: 'member_event',
        title: `New event: ${event.title}`,
        body: `${organizerName} has posted a community event on ${formatBookingDate(event.event_date)}. Check the Member Events calendar to RSVP.`,
        metadata: { event_id: event.id },
        status: 'published',
        published_at: new Date().toISOString(),
      })
    }

    try {
      await admin.from('admin_audit_log').insert({
        admin_id: ctx.userId,
        action: `member_event.${body.status}`,
        target_type: 'member_event',
        target_id: id,
        payload: { status: body.status },
      })
    } catch { /* table may not exist yet */ }

    return NextResponse.json({ ok: true, status: body.status })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
