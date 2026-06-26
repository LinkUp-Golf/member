export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { withAuth } from '@/lib/auth/with-auth'
import { createRouteHandlerClient } from '@/lib/supabase-server'
import { validateString, validateDate } from '@/lib/validation'
import type { AuthContext } from '@/lib/auth/types'

// PATCH /api/events/[id]  — organizer updates their own event
// If the event was published, it reverts to pending_review for re-approval.
export const PATCH = withAuth(async (
  req: NextRequest,
  ctx: AuthContext,
  routeCtx?: { params: Record<string, string> }
) => {
  const id = routeCtx?.params?.['id']
  if (!id) return NextResponse.json({ error: 'Missing event id' }, { status: 400 })

  const supabase = createRouteHandlerClient(cookies())

  // Verify ownership
  const { data: existing } = await supabase
    .from('member_events')
    .select('id, organizer_id, status')
    .eq('id', id)
    .single()

  if (!existing) return NextResponse.json({ error: 'Event not found' }, { status: 404 })
  if (existing.organizer_id !== ctx.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as Record<string, unknown>
  const errors: string[] = []

  if (body.title !== undefined) {
    const c = validateString(body.title, 'title', { min: 3, max: 100 })
    if (!c.valid) errors.push(...c.errors)
  }
  if (body.description !== undefined) {
    const c = validateString(body.description, 'description', { min: 10, max: 2000 })
    if (!c.valid) errors.push(...c.errors)
  }
  if (body.event_date !== undefined) {
    const c = validateDate(body.event_date, 'event_date')
    if (!c.valid) errors.push(...c.errors)
  }
  if (body.event_time !== undefined) {
    const c = validateString(body.event_time, 'event_time', { min: 4, max: 8 })
    if (!c.valid) errors.push(...c.errors)
  }
  if (body.location !== undefined) {
    const c = validateString(body.location, 'location', { min: 2, max: 200 })
    if (!c.valid) errors.push(...c.errors)
  }
  if (errors.length) return NextResponse.json({ error: errors[0] }, { status: 400 })

  const update: Record<string, unknown> = {}
  if (body.title       !== undefined) update.title        = (body.title as string).trim()
  if (body.description !== undefined) update.description  = (body.description as string).trim()
  if (body.event_date  !== undefined) update.event_date   = body.event_date
  if ('event_end_date' in body)       update.event_end_date = body.event_end_date ?? null
  if (body.event_time  !== undefined) update.event_time   = body.event_time
  if (body.location    !== undefined) update.location     = (body.location as string).trim()
  if ('external_url'   in body)       update.external_url = body.external_url ?? null

  // Editing a published event sends it back for re-approval
  if (existing.status === 'published') {
    update.status = 'pending_review'
    update.reviewed_by = null
  }

  const { data, error } = await supabase
    .from('member_events')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
})

// DELETE /api/events/[id]  — organizer deletes their own event
export const DELETE = withAuth(async (
  _req: NextRequest,
  ctx: AuthContext,
  routeCtx?: { params: Record<string, string> }
) => {
  const id = routeCtx?.params?.['id']
  if (!id) return NextResponse.json({ error: 'Missing event id' }, { status: 400 })

  const supabase = createRouteHandlerClient(cookies())

  const { data: existing } = await supabase
    .from('member_events')
    .select('id, organizer_id')
    .eq('id', id)
    .single()

  if (!existing) return NextResponse.json({ error: 'Event not found' }, { status: 404 })
  if (existing.organizer_id !== ctx.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { error } = await supabase
    .from('member_events')
    .delete()
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
})
