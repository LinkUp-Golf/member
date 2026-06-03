export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import type { AuthContext } from '@/lib/auth/types'

// PATCH /api/conversations/[id]/participants/[memberId]
// Update a participant's role. Callers must be a moderator.
// Body: { role: 'member' | 'moderator' }
export const PATCH = withAuth(async (
  req: NextRequest,
  ctx: AuthContext,
  routeCtx?: { params: Record<string, string> }
) => {
  const convId   = routeCtx?.params?.['id']
  const memberId = routeCtx?.params?.['memberId']
  if (!convId || !memberId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const { role } = await req.json() as { role: string }
  if (role !== 'member' && role !== 'moderator') {
    return NextResponse.json({ error: 'role must be member or moderator' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Caller must be a moderator in this conversation
  const { data: myParticipant } = await admin
    .from('conversation_participants')
    .select('role')
    .eq('conversation_id', convId)
    .eq('member_id', ctx.userId)
    .single()

  if (!myParticipant || myParticipant.role !== 'moderator') {
    return NextResponse.json({ error: 'Only moderators can change roles' }, { status: 403 })
  }

  const { error } = await admin
    .from('conversation_participants')
    .update({ role })
    .eq('conversation_id', convId)
    .eq('member_id', memberId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
})

// DELETE /api/conversations/[id]/participants/[memberId]
// Remove a member from the group.
// Allowed: a moderator removing anyone, OR a member leaving themselves.
// A moderator can also remove another moderator.
export const DELETE = withAuth(async (
  _req: NextRequest,
  ctx: AuthContext,
  routeCtx?: { params: Record<string, string> }
) => {
  const convId   = routeCtx?.params?.['id']
  const memberId = routeCtx?.params?.['memberId']
  if (!convId || !memberId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const admin = createAdminClient()

  const [myRes, targetRes] = await Promise.all([
    admin
      .from('conversation_participants')
      .select('role')
      .eq('conversation_id', convId)
      .eq('member_id', ctx.userId)
      .single(),
    admin
      .from('conversation_participants')
      .select('role')
      .eq('conversation_id', convId)
      .eq('member_id', memberId)
      .single(),
  ])

  if (!myRes.data) return NextResponse.json({ error: 'Not a participant' }, { status: 403 })
  if (!targetRes.data) return NextResponse.json({ error: 'Member not in group' }, { status: 404 })

  const isSelf      = memberId === ctx.userId
  const isModerator = myRes.data.role === 'moderator'

  if (!isSelf && !isModerator) {
    return NextResponse.json({ error: 'Only moderators can remove members' }, { status: 403 })
  }

  const { error } = await admin
    .from('conversation_participants')
    .delete()
    .eq('conversation_id', convId)
    .eq('member_id', memberId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return new NextResponse(null, { status: 204 })
})
