export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import type { AuthContext } from '@/lib/auth/types'
import type { ConversationWithDetails, MessageWithSender, ParticipantRole, ParticipantStatus } from '@/types'

// GET /api/conversations/[id]
export const GET = withAuth(async (
  _req: NextRequest,
  ctx: AuthContext,
  routeCtx?: { params: Record<string, string> }
) => {
  const convId = routeCtx?.params?.['id']
  if (!convId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const admin = createAdminClient()

  // Verify participation
  const { data: myParticipation } = await admin
    .from('conversation_participants')
    .select('last_read_at, role, status')
    .eq('conversation_id', convId)
    .eq('member_id', ctx.userId)
    .single()

  if (!myParticipation) {
    return NextResponse.json({ error: 'Not a participant' }, { status: 403 })
  }

  // Fetch conversation with all participants
  const { data: conv, error } = await admin
    .from('conversations')
    .select(`
      id, type, name, course_id, created_by, created_at, updated_at,
      participants:conversation_participants(
        last_read_at,
        role,
        status,
        member:members(
          id, first_name, last_name,
          profile:member_profiles(avatar_url)
        )
      )
    `)
    .eq('id', convId)
    .single()

  if (error || !conv) {
    return NextResponse.json({ error: error?.message ?? 'Not found' }, { status: 404 })
  }

  // Fetch last message
  const { data: lastMsgs } = await admin
    .rpc('get_last_messages_for_conversations', { conv_ids: [convId] })

  const rawLast = lastMsgs?.[0]
  const lastMessage: MessageWithSender | null = rawLast
    ? {
        id: rawLast.id,
        conversation_id: rawLast.conversation_id,
        sender_id: rawLast.sender_id,
        body: rawLast.body,
        created_at: rawLast.created_at,
        edited_at: rawLast.edited_at,
        deleted_at: rawLast.deleted_at,
        sender: {
          id: rawLast.sender_id,
          first_name: rawLast.sender_first,
          last_name: rawLast.sender_last,
          profile: { avatar_url: rawLast.sender_avatar ?? null },
        },
      }
    : null

  const myLastRead = myParticipation.last_read_at
  const hasUnread =
    !!lastMessage &&
    lastMessage.sender_id !== ctx.userId &&
    (!myLastRead || new Date(lastMessage.created_at) > new Date(myLastRead))

  type RawParticipant = {
    last_read_at: string | null
    role: string
    status: string
    member: { id: string; first_name: string; last_name: string; profile: { avatar_url: string | null } | null } | null
  }
  const participants = (conv.participants ?? []) as unknown as RawParticipant[]

  const result: ConversationWithDetails = {
    ...conv,
    participants: participants
      .filter((cp): cp is RawParticipant & { member: NonNullable<RawParticipant['member']> } => cp.member !== null)
      .map(cp => ({
        member: cp.member,
        last_read_at: cp.last_read_at,
        role: (cp.role ?? 'member') as ParticipantRole,
        status: (cp.status ?? 'active') as ParticipantStatus,
      })),
    last_message: lastMessage,
    unread_count: hasUnread ? 1 : 0,
    my_status: (myParticipation.status ?? 'active') as ParticipantStatus,
  }

  return NextResponse.json(result)
})

// PATCH /api/conversations/[id]
// Update the group name. Only moderators can rename a group.
export const PATCH = withAuth(async (
  req: NextRequest,
  ctx: AuthContext,
  routeCtx?: { params: Record<string, string> }
) => {
  const convId = routeCtx?.params?.['id']
  if (!convId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const { name } = await req.json() as { name: string }
  const trimmed = name?.trim() ?? ''
  if (trimmed.length > 100) {
    return NextResponse.json({ error: 'Group name must be 100 characters or less' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: myParticipant } = await admin
    .from('conversation_participants')
    .select('role')
    .eq('conversation_id', convId)
    .eq('member_id', ctx.userId)
    .single()

  if (!myParticipant) return NextResponse.json({ error: 'Not a participant' }, { status: 403 })
  if (myParticipant.role !== 'moderator') {
    return NextResponse.json({ error: 'Only moderators can rename the group' }, { status: 403 })
  }

  const { error } = await admin
    .from('conversations')
    .update({ name: trimmed || null })
    .eq('id', convId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ name: trimmed || null })
})
