export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { validateString } from '@/lib/validation'
import type { AuthContext } from '@/lib/auth/types'

// PATCH /api/conversations/[id]/messages/[messageId]
// Edit the body of a message. Only the sender can edit their own messages.
export const PATCH = withAuth(async (
  req: NextRequest,
  ctx: AuthContext,
  routeCtx?: { params: Record<string, string> }
) => {
  const convId     = routeCtx?.params?.['id']
  const messageId  = routeCtx?.params?.['messageId']
  if (!convId || !messageId) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  }

  const { body: newBody } = await req.json() as { body: string }
  const validation = validateString(newBody, 'body', { min: 1, max: 4000 })
  if (!validation.valid) {
    return NextResponse.json({ error: validation.errors[0] }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: message } = await admin
    .from('messages')
    .select('sender_id, deleted_at')
    .eq('id', messageId)
    .eq('conversation_id', convId)
    .single()

  if (!message) return NextResponse.json({ error: 'Message not found' }, { status: 404 })
  if (message.deleted_at) return NextResponse.json({ error: 'Cannot edit a deleted message' }, { status: 400 })
  if (message.sender_id !== ctx.userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data, error } = await admin
    .from('messages')
    .update({ body: newBody.trim(), edited_at: new Date().toISOString() })
    .eq('id', messageId)
    .select(`
      id, conversation_id, sender_id, body, created_at, edited_at, deleted_at,
      sender:members(id, first_name, last_name, profile:member_profiles(avatar_url))
    `)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Update failed' }, { status: 500 })

  return NextResponse.json(data)
})

// DELETE /api/conversations/[id]/messages/[messageId]
// Soft-delete a message.
// Allowed: the message sender, OR any moderator of the conversation.
export const DELETE = withAuth(async (
  _req: NextRequest,
  ctx: AuthContext,
  routeCtx?: { params: Record<string, string> }
) => {
  const convId    = routeCtx?.params?.['id']
  const messageId = routeCtx?.params?.['messageId']
  if (!convId || !messageId) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  }

  const admin = createAdminClient()

  const [msgRes, participantRes] = await Promise.all([
    admin
      .from('messages')
      .select('sender_id, deleted_at')
      .eq('id', messageId)
      .eq('conversation_id', convId)
      .single(),
    admin
      .from('conversation_participants')
      .select('role')
      .eq('conversation_id', convId)
      .eq('member_id', ctx.userId)
      .single(),
  ])

  const message     = msgRes.data
  const participant = participantRes.data

  if (!message) return NextResponse.json({ error: 'Message not found' }, { status: 404 })
  if (message.deleted_at) return NextResponse.json({ error: 'Already deleted' }, { status: 400 })
  if (!participant) return NextResponse.json({ error: 'Not a participant' }, { status: 403 })

  const canDelete =
    message.sender_id === ctx.userId || participant.role === 'moderator'

  if (!canDelete) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const deletedAt = new Date().toISOString()
  const { error } = await admin
    .from('messages')
    .update({ deleted_at: deletedAt })
    .eq('id', messageId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ id: messageId, deleted_at: deletedAt })
})
