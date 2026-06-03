export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { withAuth } from '@/lib/auth/with-auth'
import { createRouteHandlerClient, createAdminClient } from '@/lib/supabase-server'
import { validateString } from '@/lib/validation'
import type { AuthContext } from '@/lib/auth/types'

const DEFAULT_PAGE_SIZE = 30
const MAX_PAGE_SIZE = 100

// GET /api/conversations/[id]/messages?limit=30&before=<created_at ISO>
export const GET = withAuth(async (
  req: NextRequest,
  ctx: AuthContext,
  routeCtx?: { params: Record<string, string> }
) => {
  const convId = routeCtx?.params?.['id']
  if (!convId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const admin = createAdminClient()

  const { searchParams } = new URL(req.url)
  const limit = Math.min(Number(searchParams.get('limit') ?? DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE)
  const before = searchParams.get('before')

  // Verify the caller is a participant (admin client bypasses RLS recursion)
  const { data: participation } = await admin
    .from('conversation_participants')
    .select('id')
    .eq('conversation_id', convId)
    .eq('member_id', ctx.userId)
    .single()

  if (!participation) {
    return NextResponse.json({ error: 'Not a participant' }, { status: 403 })
  }

  let query = admin
    .from('messages')
    .select('*, sender:members(id, first_name, last_name, profile:member_profiles(avatar_url))')
    .eq('conversation_id', convId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit + 1)

  if (before) {
    query = query.lt('created_at', before)
  }

  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const hasMore = (data?.length ?? 0) > limit
  const messages = (data ?? []).slice(0, limit).reverse()
  const nextCursor = hasMore ? messages[0]?.created_at ?? null : null

  return NextResponse.json({ messages, hasMore, nextCursor })
})

// POST /api/conversations/[id]/messages
export const POST = withAuth(async (
  req: NextRequest,
  ctx: AuthContext,
  routeCtx?: { params: Record<string, string> }
) => {
  const convId = routeCtx?.params?.['id']
  if (!convId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const admin = createAdminClient()
  // Session client only for the auth.getUser() path already done by withAuth.
  // We keep a reference for cookie forwarding but use admin for DB writes.
  const _supabase = createRouteHandlerClient(cookies())

  const body = await req.json() as { body: string }

  const check = validateString(body.body, 'message', { min: 1, max: 4000 })
  if (!check.valid) return NextResponse.json({ error: check.errors[0] }, { status: 400 })

  // Verify participation
  const { data: participation } = await admin
    .from('conversation_participants')
    .select('id')
    .eq('conversation_id', convId)
    .eq('member_id', ctx.userId)
    .single()

  if (!participation) {
    return NextResponse.json({ error: 'Not a participant' }, { status: 403 })
  }

  const { data, error } = await admin
    .from('messages')
    .insert({ conversation_id: convId, sender_id: ctx.userId, body: body.body })
    .select('*, sender:members(id, first_name, last_name, profile:member_profiles(avatar_url))')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data, { status: 201 })
})
