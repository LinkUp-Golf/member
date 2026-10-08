// Sending a direct message on a member's behalf, from server code.
//
// The conversations and messages routes do this for a member typing in the
// app; this is the same write for a message the app composes for them (a
// booker pinging a player). It finds the existing thread between the two
// before creating one, as POST /api/conversations does, so a ping lands in the
// conversation they already have rather than starting a second.
//
// It does not notify — the caller decides what the recipient hears, because a
// composed message usually has a better push than the raw text.

import type { createAdminClient } from '@/lib/supabase-server'

type AdminClient = ReturnType<typeof createAdminClient>

export async function sendDirectMessage(
  admin: AdminClient,
  params: { fromId: string; toId: string; body: string; courseId: string | null },
): Promise<{ conversationId: string } | { error: string }> {
  const { fromId, toId, body, courseId } = params

  const { data: existingId } = await admin.rpc('find_direct_conversation', {
    user1_id: fromId,
    user2_id: toId,
  })

  let conversationId = existingId as string | null
  if (!conversationId) {
    const { data: conv, error } = await admin
      .from('conversations')
      .insert({ course_id: courseId, type: 'direct', name: null, created_by: fromId })
      .select('id')
      .single()
    if (error || !conv) return { error: error?.message ?? 'Could not start a conversation' }
    conversationId = conv.id as string

    const { error: participantsError } = await admin
      .from('conversation_participants')
      .insert([fromId, toId].map(id => ({
        conversation_id: conversationId,
        member_id: id,
        role: 'member',
        status: 'active',
      })))
    if (participantsError) return { error: participantsError.message }
  }

  const { error: messageError } = await admin
    .from('messages')
    .insert({ conversation_id: conversationId, sender_id: fromId, body })
  if (messageError) return { error: messageError.message }

  return { conversationId: conversationId as string }
}
