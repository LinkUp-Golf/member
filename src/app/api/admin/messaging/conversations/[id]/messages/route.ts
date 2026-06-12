export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import type { AuthContext } from '@/lib/auth/types'

// GET /api/admin/messaging/conversations/[id]/messages
// Returns all messages in a conversation (including deleted), newest-first,
// paginated via cursor (before=<created_at>). Admin-only.
export const GET = withAuth(
  async (
    req: NextRequest,
    _ctx: AuthContext,
    routeCtx?: { params: Record<string, string> }
  ) => {
    const convId = routeCtx?.params?.['id']
    if (!convId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const { searchParams } = new URL(req.url)
    const limit  = Math.min(Number(searchParams.get('limit') ?? 50), 200)
    const before = searchParams.get('before')

    const admin = createAdminClient()

    // Verify the conversation exists
    const { data: conv } = await admin
      .from('conversations')
      .select('id, type, name')
      .eq('id', convId)
      .single()

    if (!conv) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

    let query = admin
      .from('messages')
      .select(`
        id, body, created_at, edited_at, deleted_at,
        sender:members(
          id, first_name, last_name,
          profile:member_profiles(avatar_url)
        )
      `)
      .eq('conversation_id', convId)
      .order('created_at', { ascending: false })
      .limit(limit + 1)

    if (before) query = query.lt('created_at', before)

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const hasMore  = (data?.length ?? 0) > limit
    const messages = (data ?? []).slice(0, limit)
    const nextCursor = hasMore ? messages[messages.length - 1]?.created_at ?? null : null

    return NextResponse.json({ messages, hasMore, nextCursor })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
