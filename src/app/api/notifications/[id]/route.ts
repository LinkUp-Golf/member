export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createRouteHandlerClient } from '@/lib/supabase-server'
import { cookies } from 'next/headers'
import type { AuthContext } from '@/lib/auth/types'

// PATCH /api/notifications/[id]
// Marks a single notification as read for the current member.
export const PATCH = withAuth(
  async (
    _req: NextRequest,
    ctx: AuthContext,
    routeCtx?: { params: Record<string, string> }
  ) => {
    const notifId = routeCtx?.params?.['id']
    if (!notifId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const supabase = createRouteHandlerClient(cookies())

    const { error } = await supabase
      .from('notification_log')
      .update({ read_at: new Date().toISOString() })
      .eq('id', notifId)
      .eq('member_id', ctx.userId)
      .is('read_at', null)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  },
  { skipGHLCheck: true }
)
