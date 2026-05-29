export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { withAuth } from '@/lib/auth/with-auth'
import { createRouteHandlerClient, createAdminClient } from '@/lib/supabase-server'
import type { AuthContext } from '@/lib/auth/types'

export const GET = withAuth(async (
  _req: NextRequest,
  ctx: AuthContext,
  routeCtx?: { params: Record<string, string> }
) => {
  const admin = createAdminClient()
  const supabase = createRouteHandlerClient(cookies())

  const [memberRes, playedRes] = await Promise.all([
    // Admin client so any authenticated user can view any member profile
    // regardless of course_memberships RLS restrictions.
    admin
      .from('members')
      .select('*, profile:member_profiles(*), home_course:courses(*)')
      .eq('id', routeCtx!.params.id)
      .single(),

    // Session client is fine here — play_history RLS allows the caller
    // to read their own play history rows.
    supabase
      .from('play_history')
      .select('id')
      .eq('member_id', ctx.userId)
      .contains('played_with', [routeCtx!.params.id])
      .limit(1),
  ])

  if (memberRes.error || !memberRes.data) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  return NextResponse.json({
    member: memberRes.data,
    hasPlayedWith: (playedRes.data?.length ?? 0) > 0,
  })
})
