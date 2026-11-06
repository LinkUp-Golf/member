export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
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

    // Live: user-specific — never cache. From the rounds themselves (bookings
    // and hosted events, see 20260911000001): play_history was read here but
    // nothing ever wrote to it, so the badge was always false. Service role,
    // since the function reads other members' bookings; it only ever answers
    // about the caller.
    createAdminClient().rpc('members_played_with', { p_member_id: ctx.userId }),

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
    // A round already played: one booked for next week isn't "played together" yet.
    hasPlayedWith: ((playedRes.data ?? []) as Array<{ member_id: string; rounds: number }>)
      .some(r => r.member_id === memberId && Number(r.rounds) > 0),
    focusLinkupGroups: subsRes.data?.map(s =>
      s.industry_focus === 'Other' && s.custom_label ? s.custom_label : s.industry_focus
    ) ?? [],
  })
})
