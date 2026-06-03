export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { withAuth } from '@/lib/auth/with-auth'
import { createRouteHandlerClient, createAdminClient } from '@/lib/supabase-server'
import { getCache, withCache } from '@/lib/cache'
import {
  COURSE_LINKUPS_NS,
  COURSE_LINKUPS_TTL_MS,
  courseLinkupsKey,
} from '@/lib/cache/keys'
import type { AuthContext } from '@/lib/auth/types'

// GET /api/focus-linkups — upcoming focus linkups + user subscriptions
//
// Cache strategy (split):
//   linkups      — cached per course (1 hour). Same for all course members.
//   subscriptions — never cached. User-specific; changes per subscribe/unsubscribe.
export const GET = withAuth(async (_req: NextRequest, ctx: AuthContext) => {
  if (!ctx.homeCourseId) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }
  const courseId = ctx.homeCourseId

  const today  = new Date().toISOString().slice(0, 10)
  const cache  = getCache(COURSE_LINKUPS_NS)
  const key    = courseLinkupsKey(courseId)

  // Fetch linkups (shared, cached) and subscriptions (user-specific, fresh) in parallel.
  const [linkups, subsRes] = await Promise.all([
    withCache(
      cache,
      key,
      async () => {
        const admin = createAdminClient()
        const { data, error } = await admin
          .from('focus_linkups')
          .select('*')
          .eq('course_id', courseId)
          .gte('focus_date', today)
          .order('focus_date', { ascending: true })
          .limit(10)
        if (error) throw new Error(error.message)
        return data ?? []
      },
      COURSE_LINKUPS_TTL_MS
    ),

    // Subscriptions are user-specific — never cache, always fresh.
    createRouteHandlerClient(cookies())
      .from('focus_linkup_subscriptions')
      .select('industry_focus')
      .eq('member_id', ctx.userId),
  ])

  return NextResponse.json({
    linkups,
    subscriptions: subsRes.data?.map(s => s.industry_focus) ?? [],
  })
})
