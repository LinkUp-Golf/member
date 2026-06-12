export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { withAuth } from '@/lib/auth/with-auth'
import { createRouteHandlerClient, createAdminClient } from '@/lib/supabase-server'
import { validateString } from '@/lib/validation'
import { messageRateLimit, messageBurstLimit } from '@/lib/rateLimit'
import { sendPushToMembers, NotificationTemplates } from '@/lib/push'
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

  // Verify the caller is an active participant (admin client bypasses RLS recursion)
  const { data: participation } = await admin
    .from('conversation_participants')
    .select('id, status')
    .eq('conversation_id', convId)
    .eq('member_id', ctx.userId)
    .single()

  if (!participation) {
    return NextResponse.json({ error: 'Not a participant' }, { status: 403 })
  }
  if (participation.status === 'pending') {
    return NextResponse.json({ error: 'Invitation not yet accepted' }, { status: 403 })
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

  // Verify the caller is an active participant
  const { data: participation } = await admin
    .from('conversation_participants')
    .select('id, status')
    .eq('conversation_id', convId)
    .eq('member_id', ctx.userId)
    .single()

  if (!participation) {
    return NextResponse.json({ error: 'Not a participant' }, { status: 403 })
  }
  if (participation.status === 'pending') {
    return NextResponse.json({ error: 'Invitation not yet accepted' }, { status: 403 })
  }

  // Check if the member is messaging-muted by an admin
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

  // Rate limits — per-minute global + per-conversation burst
  const globalLimit = messageRateLimit(ctx.userId)
  if (!globalLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many messages. Please slow down.' },
      {
        status: 429,
        headers: {
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(globalLimit.resetAt),
          'Retry-After': String(Math.ceil((globalLimit.resetAt - Date.now()) / 1000)),
        },
      }
    )
  }
  const burstLimit = messageBurstLimit(ctx.userId, convId)
  if (!burstLimit.allowed) {
    return NextResponse.json(
      { error: 'Sending too fast in this conversation. Please wait a moment.' },
      {
        status: 429,
        headers: {
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(burstLimit.resetAt),
          'Retry-After': String(Math.ceil((burstLimit.resetAt - Date.now()) / 1000)),
        },
      }
    )
  }

  const { data, error } = await admin
    .from('messages')
    .insert({ conversation_id: convId, sender_id: ctx.userId, body: body.body })
    .select('*, sender:members(id, first_name, last_name, profile:member_profiles(avatar_url))')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Notify other active participants (fire-and-forget)
  const senderName = [data.sender?.first_name, data.sender?.last_name].filter(Boolean).join(' ') || 'Someone'
  ;(async () => {
    const { data: participants } = await admin
      .from('conversation_participants')
      .select('member_id')
      .eq('conversation_id', convId)
      .eq('status', 'active')
      .neq('member_id', ctx.userId)
    const recipientIds = (participants ?? []).map((p: { member_id: string }) => p.member_id)
    if (recipientIds.length) {
      await sendPushToMembers(recipientIds, NotificationTemplates.newMessage(senderName, body.body, convId))
    }
  })().catch(() => {})

  return NextResponse.json(data, { status: 201 })
})
