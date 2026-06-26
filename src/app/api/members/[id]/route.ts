export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { withAuth } from '@/lib/auth/with-auth'
import { createRouteHandlerClient, createAdminClient } from '@/lib/supabase-server'
import { getCache, withCache } from '@/lib/cache'
import {
  MEMBER_DETAIL_NS,
  MEMBER_DETAIL_TTL_MS,
  memberDetailKey,
} from '@/lib/cache/keys'
import type { AuthContext } from '@/lib/auth/types'

// GET /api/members/[id]
//
// Cache strategy (split):
//   member profile — cached by memberId (30 min). Public data, same for every viewer.
//   hasPlayedWith  — never cached. Caller-specific; depends on ctx.userId.
//
// Safety: hasPlayedWith is re-queried live on every request so user A never
// sees user B's play-relationship status. The cached member object contains
// no session-specific data.
export const GET = withAuth(async (
  _req: NextRequest,
  ctx: AuthContext,
  routeCtx?: { params: Record<string, string> }
) => {
  const memberId = routeCtx?.params?.['id']
  if (!memberId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  const cache    = getCache(MEMBER_DETAIL_NS)

  const supabase = createRouteHandlerClient(cookies())

  const [memberData, playedRes, subsRes] = await Promise.all([
    // Cached: public profile visible to any authenticated member.
    withCache(
      cache,
      memberDetailKey(memberId),
      async () => {
        const admin = createAdminClient()
        const { data, error } = await admin
          .from('members')
          .select('*, profile:member_profiles(*), home_course:courses!members_home_course_id_fkey(*)')
          .eq('id', memberId)
          .single()
        if (error || !data) throw new Error('Member not found')
        return data
      },
      MEMBER_DETAIL_TTL_MS
    ),

    // Live: user-specific — never cache.
    supabase
      .from('play_history')
      .select('id')
      .eq('member_id', ctx.userId)
      .contains('played_with', [memberId])
      .limit(1),

    // Member's focus linkup subscriptions — not user-specific, but not worth caching.
    createAdminClient()
      .from('focus_linkup_subscriptions')
      .select('industry_focus, custom_label, status')
      .eq('member_id', memberId)
      .eq('status', 'approved'),
  ])

  if (!memberData) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  return NextResponse.json({
    member: memberData,
    hasPlayedWith: (playedRes.data?.length ?? 0) > 0,
    focusLinkupGroups: subsRes.data?.map(s =>
      s.industry_focus === 'Other' && s.custom_label ? s.custom_label : s.industry_focus
    ) ?? [],
  })
})
