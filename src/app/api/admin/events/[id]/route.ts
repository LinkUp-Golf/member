export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { formatBookingDate } from '@/lib/utils'
import { sendPushToMember, NotificationTemplates } from '@/lib/push'
import { validateString, validateDate } from '@/lib/validation'
import type { AuthContext } from '@/lib/auth/types'

const VALID_STATUSES = new Set(['published', 'rejected', 'pending_review'])

interface PatchBody {
  status?: string
  rejection_reason?: string
  title?: string
  description?: string
  event_date?: string
  event_end_date?: string | null
  event_time?: string
  location?: string
  external_url?: string | null
}

export const PATCH = withAuth(
  async (req: NextRequest, ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing event id' }, { status: 400 })

    const body = await req.json() as PatchBody
    const admin = createAdminClient()

    // General field edit (admin correcting event details) — applies immediately,
    // no status change, so it doesn't reset an already-published event for re-review.
    if (!body.status) {
      const errors: string[] = []
      if (body.title !== undefined) errors.push(...validateString(body.title, 'title', { min: 3, max: 100 }).errors)
      if (body.description !== undefined) errors.push(...validateString(body.description, 'description', { min: 10, max: 2000 }).errors)
      if (body.event_date !== undefined) errors.push(...validateDate(body.event_date, 'event_date').errors)
      if (body.event_time !== undefined) errors.push(...validateString(body.event_time, 'event_time', { min: 4, max: 8 }).errors)
      if (body.location !== undefined) errors.push(...validateString(body.location, 'location', { min: 2, max: 200 }).errors)
      if (errors.length) return NextResponse.json({ error: errors[0] }, { status: 400 })

      const updates: Record<string, unknown> = {}
      if (body.title !== undefined) updates.title = body.title.trim()
      if (body.description !== undefined) updates.description = body.description.trim()
      if (body.event_date !== undefined) updates.event_date = body.event_date
      if ('event_end_date' in body) updates.event_end_date = body.event_end_date ?? null
      if (body.event_time !== undefined) updates.event_time = body.event_time
      if (body.location !== undefined) updates.location = body.location.trim()
      if ('external_url' in body) updates.external_url = body.external_url ?? null

      if (!Object.keys(updates).length) return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })

      const { data, error } = await admin.from('member_events').update(updates).eq('id', id).select().single()
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })

      try {
        await admin.from('admin_audit_log').insert({
          admin_id: ctx.userId,
          action: 'member_event.edit',
          target_type: 'member_event',
          target_id: id,
          payload: updates,
        })
      } catch { /* table may not exist yet */ }

      return NextResponse.json(data)
    }

    if (!VALID_STATUSES.has(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    const trimmedReason = body.rejection_reason?.trim() ?? ''
    if (body.status === 'rejected' && !trimmedReason) {
      return NextResponse.json({ error: 'A rejection reason is required' }, { status: 400 })
    }

    const { data: event, error: fetchError } = await admin
      .from('member_events')
      .select('id, title, description, event_date, event_time, location, organizer_id, course_id, status')
      .eq('id', id)
      .single()

    if (fetchError || !event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }

    const rejectionReason = body.status === 'rejected' ? trimmedReason : null

    await admin
      .from('member_events')
      .update({ status: body.status, reviewed_by: ctx.userId, rejection_reason: rejectionReason })
      .eq('id', id)

    if (rejectionReason) {
      void sendPushToMember(
        event.organizer_id,
        NotificationTemplates.memberEventRejected(event.title, rejectionReason)
      ).catch(() => {})
    }

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

// DELETE /api/admin/events/[id] — admin removes any member event outright.
// RSVPs cascade-delete via member_event_rsvps' FK (on delete cascade).
export const DELETE = withAuth(
  async (_req: NextRequest, ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing event id' }, { status: 400 })

    const admin = createAdminClient()
    const { error } = await admin.from('member_events').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    try {
      await admin.from('admin_audit_log').insert({
        admin_id: ctx.userId,
        action: 'member_event.delete',
        target_type: 'member_event',
        target_id: id,
        payload: {},
      })
    } catch { /* table may not exist yet */ }

    return NextResponse.json({ ok: true })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
