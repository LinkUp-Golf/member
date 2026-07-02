export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { addTagToContact } from '@/lib/ghl/client'
import type { AuthContext } from '@/lib/auth/types'

export const PATCH = withAuth(
  async (req: NextRequest, ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing request id' }, { status: 400 })

    const body = await req.json() as { action?: 'approve' | 'deny' }
    if (body.action !== 'approve' && body.action !== 'deny') {
      return NextResponse.json({ error: 'action must be "approve" or "deny"' }, { status: 400 })
    }

    const admin = createAdminClient()

    const { data: request } = await admin
      .from('event_access_requests')
      .select('*, member:members!member_id(id, ghl_contact_id, ghl_tags), course:courses(access_tag)')
      .eq('id', id)
      .single()

    if (!request) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
    if (request.status !== 'pending') return NextResponse.json({ error: 'Request already reviewed' }, { status: 409 })

    // Deny just disregards the request — no tag change, nothing to track.
    if (body.action === 'deny') {
      const { error } = await admin.from('event_access_requests').delete().eq('id', id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true })
    }

    // Approve: grant the course's access_tag on the member's GHL contact
    const tag = request.course?.access_tag
    const member = request.member
    if (!tag || !member) {
      return NextResponse.json({ error: 'Course or member missing — cannot grant access' }, { status: 400 })
    }

    const added = await addTagToContact(member.ghl_contact_id, tag)
    if (!added) return NextResponse.json({ error: 'Failed to add tag in GHL' }, { status: 502 })

    const currentTags: string[] = member.ghl_tags ?? []
    if (!currentTags.includes(tag)) {
      await admin.from('members').update({ ghl_tags: [...currentTags, tag] }).eq('id', member.id)
    }

    const { data, error } = await admin
      .from('event_access_requests')
      .update({
        status: 'approved',
        reviewed_by: ctx.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  },
  { requireAdmin: true, skipGHLCheck: true }
)
