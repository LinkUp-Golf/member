import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { withAuth } from '@/lib/auth/with-auth'
import { createRouteHandlerClient } from '@/lib/supabase-server'
import { validateString } from '@/lib/validation'
import type { AuthContext } from '@/lib/auth/types'

// GET /api/conversations/[id]/messages
export const GET = withAuth(async (
  _req: NextRequest,
  ctx: AuthContext,
  routeCtx?: { params: Record<string, string> }
) => {
  const supabase = createRouteHandlerClient(cookies())

  // Verify the user is a participant
  const { data: participation } = await supabase
    .from('conversation_participants')
    .select('id')
    .eq('conversation_id', routeCtx!.params.id)
    .eq('member_id', ctx.userId)
    .single()

  if (!participation) {
    return NextResponse.json({ error: 'Not a participant' }, { status: 403 })
  }

  const { data, error } = await supabase
    .from('messages')
    .select('*, sender:members(id, first_name, last_name, profile:member_profiles(avatar_url))')
    .eq('conversation_id', routeCtx!.params.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(100)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
})

// POST /api/conversations/[id]/messages
export const POST = withAuth(async (
  req: NextRequest,
  ctx: AuthContext,
  routeCtx?: { params: Record<string, string> }
) => {
  const supabase = createRouteHandlerClient(cookies())
  const body = await req.json() as { body: string }

  const check = validateString(body.body, 'message', { min: 1, max: 4000 })
  if (!check.valid) return NextResponse.json({ error: check.errors[0] }, { status: 400 })

  // Verify participant
  const { data: participation } = await supabase
    .from('conversation_participants')
    .select('id')
    .eq('conversation_id', routeCtx!.params.id)
    .eq('member_id', ctx.userId)
    .single()

  if (!participation) {
    return NextResponse.json({ error: 'Not a participant' }, { status: 403 })
  }

  const { data, error } = await supabase
    .from('messages')
    .insert({ conversation_id: routeCtx!.params.id, sender_id: ctx.userId, body: body.body })
    .select('*, sender:members(id, first_name, last_name, profile:member_profiles(avatar_url))')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data, { status: 201 })
})
