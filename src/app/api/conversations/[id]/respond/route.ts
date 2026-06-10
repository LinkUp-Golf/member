export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import type { AuthContext } from '@/lib/auth/types'

// POST /api/conversations/[id]/respond
// Body: { action: 'accept' | 'decline' }
// Lets an invited member accept or decline a group chat invitation.
export const POST = withAuth(async (
  req: NextRequest,
  ctx: AuthContext,
  routeCtx?: { params: Record<string, string> }
) => {
  const convId = routeCtx?.params?.['id']
  if (!convId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const { action } = await req.json() as { action: 'accept' | 'decline' }
  if (action !== 'accept' && action !== 'decline') {
    return NextResponse.json({ error: 'action must be accept or decline' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Confirm the caller has a pending invitation
  const { data: participation } = await admin
    .from('conversation_participants')
    .select('id, status')
    .eq('conversation_id', convId)
    .eq('member_id', ctx.userId)
    .single()

  if (!participation) {
    return NextResponse.json({ error: 'No invitation found' }, { status: 404 })
  }
  if (participation.status !== 'pending') {
    return NextResponse.json({ error: 'No pending invitation' }, { status: 409 })
  }

  if (action === 'accept') {
    const { error } = await admin
      .from('conversation_participants')
      .update({ status: 'active' })
      .eq('id', participation.id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ status: 'active' })
  }

  // decline — remove the participant row entirely
  const { error } = await admin
    .from('conversation_participants')
    .delete()
    .eq('id', participation.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ status: 'declined' })
})
