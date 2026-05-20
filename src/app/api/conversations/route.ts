import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { withAuth } from '@/lib/auth/with-auth'
import { createRouteHandlerClient } from '@/lib/supabase-server'
import type { AuthContext } from '@/lib/auth/types'

// GET /api/conversations — list conversations with last message + unread count
export const GET = withAuth(async (_req: NextRequest, ctx: AuthContext) => {
  const supabase = createRouteHandlerClient(cookies())

  const { data: participations, error } = await supabase
    .from('conversation_participants')
    .select(`
      conversation_id,
      last_read_at,
      conversation:conversations(
        id, type, name, created_at, course_id,
        participants:conversation_participants(
          member:members(id, first_name, last_name, profile:member_profiles(avatar_url))
        )
      )
    `)
    .eq('member_id', ctx.userId)
    .order('joined_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(participations ?? [])
})

// POST /api/conversations — create a new conversation
export const POST = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  const supabase = createRouteHandlerClient(cookies())
  const { type, name, participant_ids } = await req.json() as {
    type: 'direct' | 'group'
    name?: string
    participant_ids: string[]
  }

  if (!participant_ids?.length) {
    return NextResponse.json({ error: 'participant_ids is required' }, { status: 400 })
  }

  const { data: member } = await supabase
    .from('members').select('home_course_id').eq('id', ctx.userId).single()

  const { data: conv, error } = await supabase
    .from('conversations')
    .insert({ course_id: member?.home_course_id, type: type ?? 'direct', name: name ?? null, created_by: ctx.userId })
    .select('id')
    .single()

  if (error || !conv) return NextResponse.json({ error: error?.message ?? 'Failed' }, { status: 500 })

  const allParticipants = [...new Set([ctx.userId, ...participant_ids])]
  await supabase
    .from('conversation_participants')
    .insert(allParticipants.map(id => ({ conversation_id: conv.id, member_id: id })))

  return NextResponse.json({ id: conv.id }, { status: 201 })
})
