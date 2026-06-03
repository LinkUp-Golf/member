export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { getCache, withCache } from '@/lib/cache'
import {
  COURSE_ANN_NS,
  COURSE_ANN_TTL_MS,
  courseAnnKey,
} from '@/lib/cache/keys'
import type { AuthContext } from '@/lib/auth/types'

// GET /api/announcements
// ?limit=n   — max results (default: 50)
//
// Cache strategy: per-course, 5-min TTL.
// Safe because all members of a course see the same published announcements.
// Invalidated by admin mutations and when a booking auto-posts an announcement.
export const GET = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  if (!ctx.homeCourseId) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }
  const courseId = ctx.homeCourseId

  const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '50', 10)
  const cache = getCache(COURSE_ANN_NS)
  const key   = courseAnnKey(courseId, limit)
  const admin = createAdminClient()

  const [allAnnouncements, subscriptionsResult] = await Promise.all([
    withCache(
      cache,
      key,
      async () => {
        const { data, error } = await admin
          .from('announcements')
          .select('*')
          .eq('course_id', courseId)
          .eq('status', 'published')
          .order('published_at', { ascending: false })
          .limit(limit)

        if (error) throw new Error(error.message)
        return data ?? []
      },
      COURSE_ANN_TTL_MS
    ),
    admin
      .from('focus_linkup_subscriptions')
      .select('industry_focus')
      .eq('member_id', ctx.memberId),
  ])

  const subscribedCategories = new Set(
    (subscriptionsResult.data ?? []).map((s: { industry_focus: string }) => s.industry_focus)
  )

  const data = allAnnouncements.filter((a: { type: string; focus_linkup_categories?: string[] }) => {
    if (a.type !== 'focus_linkup') return true
    const cats = a.focus_linkup_categories
    if (!cats?.length) return true
    return cats.some((c: string) => subscribedCategories.has(c))
  })

  return NextResponse.json(data)
})
