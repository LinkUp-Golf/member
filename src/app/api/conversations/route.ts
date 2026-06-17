export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { withAuth } from '@/lib/auth/with-auth'
import { createRouteHandlerClient, createAdminClient } from '@/lib/supabase-server'
import type { AuthContext } from '@/lib/auth/types'
import { inviteRateLimit } from '@/lib/rateLimit'
import type { ConversationWithDetails, MessageWithSender, ParticipantRole, ParticipantStatus } from '@/types'

// GET /api/conversations — list all conversations for the authenticated user,
// ordered by most-recent activity, with last_message and unread_count.
// ?counts_only=true — returns { unread_messages, pending_invitations } for badge use.
export const GET = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  const countsOnly = req.nextUrl.searchParams.get('counts_only') === 'true'
  const admin = createAdminClient()

  // Step 1: Fetch all participations + nested conversation + all participants.
  // Admin client bypasses RLS so no recursion risk on conversation_participants.
  const { data: participations, error } = await admin
    .from('conversation_participants')
    .select(`
      conversation_id,
      last_read_at,
      status,
      conversation:conversations(
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
      )
    `)
    .eq('member_id', ctx.userId)
    .order('joined_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!participations?.length) return NextResponse.json([])

  const convIds = participations.map(p => p.conversation_id)

  // Step 2: Batch-fetch last message per conversation via RPC
  const { data: lastMsgs } = await admin
    .rpc('get_last_messages_for_conversations', { conv_ids: convIds })

  const lastMsgMap: Record<string, MessageWithSender> = {}
  for (const row of lastMsgs ?? []) {
    lastMsgMap[row.conversation_id] = {
      id: row.id,
      conversation_id: row.conversation_id,
      sender_id: row.sender_id,
      body: row.body,
      created_at: row.created_at,
      edited_at: row.edited_at,
      deleted_at: row.deleted_at,
      sender: {
        id: row.sender_id,
        first_name: row.sender_first,
        last_name: row.sender_last,
        profile: { avatar_url: row.sender_avatar ?? null },
      },
    }
  }

  // Step 3: Assemble ConversationWithDetails for each participation
  const result: ConversationWithDetails[] = participations
    .map(p => {
      const conv = Array.isArray(p.conversation) ? p.conversation[0] : p.conversation
      if (!conv) return null

      const lastMessage = lastMsgMap[p.conversation_id] ?? null
      const myLastRead = p.last_read_at

      // A conversation is unread if the last message was sent by someone else
      // and arrives after this user's last_read_at timestamp.
      const myStatus = (p.status ?? 'active') as ParticipantStatus
      // Pending members have no unread state — they haven't joined yet
      const hasUnread =
        myStatus === 'active' &&
        !!lastMessage &&
        lastMessage.sender_id !== ctx.userId &&
        (!myLastRead || new Date(lastMessage.created_at) > new Date(myLastRead))

      // Supabase SDK infers nested join types as arrays even for 1:1 relations.
      // We cast to the known runtime shape before building the response object.
      type RawParticipant = {
        last_read_at: string | null
        role: string
        status: string
        member: { id: string; first_name: string; last_name: string; profile: { avatar_url: string | null } | null }
      }
      const participants = (conv.participants ?? []) as unknown as RawParticipant[]

      return {
        ...conv,
        participants: participants.map(cp => ({
          member: cp.member,
          last_read_at: cp.last_read_at,
          role: (cp.role ?? 'member') as ParticipantRole,
          status: (cp.status ?? 'active') as ParticipantStatus,
        })),
        last_message: lastMessage,
        unread_count: hasUnread ? 1 : 0,
        my_status: myStatus,
      } as ConversationWithDetails
    })
    .filter((c): c is ConversationWithDetails => c !== null)
    // Sort by last activity (updated_at) descending — most recently active first
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())

  if (countsOnly) {
    return NextResponse.json({
      unread_messages: result.filter(c => c.unread_count > 0).length,
      pending_invitations: result.filter(c => c.my_status === 'pending').length,
    })
  }

  return NextResponse.json(result)
})

// POST /api/conversations — create a conversation, preventing duplicate DMs.
export const POST = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  const supabase = createRouteHandlerClient(cookies())
  const admin = createAdminClient()
  const { type, name, participant_ids } = await req.json() as {
    type: 'direct' | 'group'
    name?: string
    participant_ids: string[]
  }

  if (!participant_ids?.length) {
    return NextResponse.json({ error: 'participant_ids is required' }, { status: 400 })
  }

  // For group chats the creator is sending invitations — apply mute + rate limit
  if (type === 'group') {
    const { data: memberRow } = await admin
      .from('members')
      .select('messaging_muted_until')
      .eq('id', ctx.userId)
      .single()

    if (memberRow?.messaging_muted_until && new Date(memberRow.messaging_muted_until) > new Date()) {
      return NextResponse.json(
        { error: 'Your messaging has been temporarily restricted. Contact an admin for help.' },
        { status: 403 }
      )
    }

    const limit = inviteRateLimit(ctx.userId)
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Too many invitations. Please wait before creating more group chats.' },
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
  }

  // For direct messages: find and return an existing conversation if one exists
  if (type === 'direct' && participant_ids.length === 1) {
    const { data: existingId } = await admin.rpc('find_direct_conversation', {
      user1_id: ctx.userId,
      user2_id: participant_ids[0],
    })

    if (existingId) {
      return NextResponse.json({ id: existingId }, { status: 200 })
    }
  }

  const { data: member } = await supabase
    .from('members')
    .select('home_course_id')
    .eq('id', ctx.userId)
    .single()

  // Use admin client so the INSERT bypasses the conversations RLS policy
  // (which requires course_memberships rows that may not exist for all members).
  // withAuth already validates the caller's session and GHL membership.
  const { data: conv, error } = await admin
    .from('conversations')
    .insert({
      course_id: member?.home_course_id,
      type: type ?? 'direct',
      name: name ?? null,
      created_by: ctx.userId,
    })
    .select('id')
    .single()

  if (error || !conv) {
    return NextResponse.json({ error: error?.message ?? 'Failed to create conversation' }, { status: 500 })
  }

  const allParticipants = [...new Set([ctx.userId, ...participant_ids])]
  await admin
    .from('conversation_participants')
    .insert(
      allParticipants.map(id => ({
        conversation_id: conv.id,
        member_id: id,
        // Creator is moderator in group chats; direct chats have no moderation
        role: (type === 'group' && id === ctx.userId) ? 'moderator' : 'member',
        // Invited members start as pending until they accept; creator is always active
        status: (type === 'group' && id !== ctx.userId) ? 'pending' : 'active',
      }))
    )

  return NextResponse.json({ id: conv.id }, { status: 201 })
})
