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

  const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '50', 10)
  const cache = getCache(COURSE_ANN_NS)
  const key   = courseAnnKey(ctx.homeCourseId, limit)

  const data = await withCache(
    cache,
    key,
    async () => {
      const admin = createAdminClient()
      const { data, error } = await admin
        .from('announcements')
        .select('*')
        .eq('course_id', ctx.homeCourseId!)
        .eq('status', 'published')
        .order('published_at', { ascending: false })
        .limit(limit)

      if (error) throw new Error(error.message)
      return data ?? []
    },
    COURSE_ANN_TTL_MS
  )

  return NextResponse.json(data)
})
