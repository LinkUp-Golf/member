export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { withAuth } from '@/lib/auth/with-auth'
import { createRouteHandlerClient } from '@/lib/supabase-server'
import type { AuthContext } from '@/lib/auth/types'

export const PATCH = withAuth(async (
  _req: NextRequest,
  ctx: AuthContext,
  routeCtx?: { params: Record<string, string> }
) => {
  const supabase = createRouteHandlerClient(cookies())

  const { error } = await supabase
    .from('bookings')
    .update({ status: 'cancelled' })
    .eq('id', routeCtx!.params.id)
    .eq('member_id', ctx.userId)   // RLS + explicit ownership check

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
})
