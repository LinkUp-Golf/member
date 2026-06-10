export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createRouteHandlerClient } from '@/lib/supabase-server'
import { cookies } from 'next/headers'
import type { AuthContext } from '@/lib/auth/types'

// GET /api/notifications
// Query params:
//   count_only=true  — returns { unread_count } only (for the bell badge)
//   limit            — page size (default 30, max 100)
//   before           — cursor: ISO timestamp (created_at < before)
export const GET = withAuth(
  async (req: NextRequest, ctx: AuthContext) => {
    const { searchParams } = new URL(req.url)
    const countOnly = searchParams.get('count_only') === 'true'
    const limit     = Math.min(Number(searchParams.get('limit') ?? 30), 100)
    const before    = searchParams.get('before')

    const supabase = createRouteHandlerClient(cookies())

    if (countOnly) {
      const { count, error } = await supabase
        .from('notification_log')
        .select('id', { count: 'exact', head: true })
        .eq('member_id', ctx.userId)
        .is('read_at', null)

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ unread_count: count ?? 0 })
    }

    let query = supabase
      .from('notification_log')
      .select('id, type, title, body, data, url, read_at, created_at')
      .eq('member_id', ctx.userId)
      .order('created_at', { ascending: false })
      .limit(limit + 1)

    if (before) query = query.lt('created_at', before)

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const hasMore     = (data?.length ?? 0) > limit
    const items       = (data ?? []).slice(0, limit)
    const nextCursor  = hasMore ? items[items.length - 1]?.created_at ?? null : null

    // Also return total unread count so the bell can refresh after page load
    const { count: unreadCount } = await supabase
      .from('notification_log')
      .select('id', { count: 'exact', head: true })
      .eq('member_id', ctx.userId)
      .is('read_at', null)

    return NextResponse.json({ notifications: items, hasMore, nextCursor, unread_count: unreadCount ?? 0 })
  },
  { skipGHLCheck: true }
)
