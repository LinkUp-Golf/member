export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { inviteRateLimit } from '@/lib/rateLimit'
import type { AuthContext } from '@/lib/auth/types'

// GET /api/conversations/[id]/participants
// Returns all participants with roles and join dates.
// Available to any participant; used by the group members panel.
export const GET = withAuth(async (
  _req: NextRequest,
  ctx: AuthContext,
  routeCtx?: { params: Record<string, string> }
) => {
  const convId = routeCtx?.params?.['id']
  if (!convId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const admin = createAdminClient()

  // Verify caller is a participant
  const { data: myParticipant } = await admin
    .from('conversation_participants')
    .select('role')
    .eq('conversation_id', convId)
    .eq('member_id', ctx.userId)
    .single()

  if (!myParticipant) return NextResponse.json({ error: 'Not a participant' }, { status: 403 })

  const { data, error } = await admin
    .from('conversation_participants')
    .select(`
      role,
      status,
      joined_at,
      member:members(
        id, first_name, last_name,
        profile:member_profiles(avatar_url)
      )
    `)
    .eq('conversation_id', convId)
    .order('joined_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data ?? [])
})

// POST /api/conversations/[id]/participants
// Adds a new member to an existing group chat (moderators only).
// The invited member starts with status 'pending' until they accept.
export const POST = withAuth(async (
  req: NextRequest,
  ctx: AuthContext,
  routeCtx?: { params: Record<string, string> }
) => {
  const convId = routeCtx?.params?.['id']
  if (!convId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const { member_id } = await req.json() as { member_id: string }
  if (!member_id) return NextResponse.json({ error: 'member_id is required' }, { status: 400 })

  const admin = createAdminClient()

  // Only moderators may add members
  const { data: myParticipant } = await admin
    .from('conversation_participants')
    .select('role, status')
    .eq('conversation_id', convId)
    .eq('member_id', ctx.userId)
    .single()

  if (!myParticipant) return NextResponse.json({ error: 'Not a participant' }, { status: 403 })
  if (myParticipant.role !== 'moderator') {
    return NextResponse.json({ error: 'Only moderators can add members' }, { status: 403 })
  }

  // Mute check and invite rate limit for the moderator sending the invite
  const { data: moderatorRow } = await admin
    .from('members')
    .select('messaging_muted_until')
    .eq('id', ctx.userId)
    .single()

  if (moderatorRow?.messaging_muted_until && new Date(moderatorRow.messaging_muted_until) > new Date()) {
    return NextResponse.json(
      { error: 'Your messaging has been temporarily restricted. Contact an admin for help.' },
      { status: 403 }
    )
  }

  const limit = inviteRateLimit(ctx.userId)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many invitations sent. Please wait before adding more members.' },
      {
        status: 429,
        headers: {
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(limit.resetAt),
          'Retry-After': String(Math.ceil((limit.resetAt - Date.now()) / 1000)),
        },
      }
    )
  }

  // Prevent duplicate participant rows
  const { data: existing } = await admin
    .from('conversation_participants')
    .select('id')
    .eq('conversation_id', convId)
    .eq('member_id', member_id)
    .single()

  if (existing) {
    return NextResponse.json({ error: 'Member is already in this group' }, { status: 409 })
  }

  const { error } = await admin
    .from('conversation_participants')
    .insert({ conversation_id: convId, member_id, role: 'member', status: 'pending' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true }, { status: 201 })
})
