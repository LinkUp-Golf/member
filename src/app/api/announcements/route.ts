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
import type { AnnouncementType } from '@/types'

const ANNOUNCEMENT_TYPES: readonly AnnouncementType[] = ['member_event', 'new_course', 'admin_broadcast', 'promotion']

// GET /api/announcements
// ?limit=n   — max results (default: 50)
// ?type=t    — only posts of this AnnouncementType (default: every type)
//
// Cache strategy: per-course, 5-min TTL.
// Safe because all members of a course see the same published announcements.
// Invalidated by admin mutations (announcements, promotions, courses).
export const GET = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  if (!ctx.homeCourseId) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }
  const courseId = ctx.homeCourseId

  const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '50', 10)
  const typeParam = req.nextUrl.searchParams.get('type')
  const type = ANNOUNCEMENT_TYPES.find(t => t === typeParam) ?? null
  if (typeParam && !type) {
    return NextResponse.json({ error: 'Unknown announcement type' }, { status: 400 })
  }
  const cache = getCache(COURSE_ANN_NS)
  const key   = courseAnnKey(courseId, limit, type)
  const admin = createAdminClient()

  const data = await withCache(
    cache,
    key,
    async () => {
      let query = admin
        .from('announcements')
        .select('*')
        .eq('course_id', courseId)
        .eq('status', 'published')
      if (type) query = query.eq('type', type)

      const { data, error } = await query
        .order('is_pinned', { ascending: false })
        .order('published_at', { ascending: false })
        .limit(limit)

      if (error) throw new Error(error.message)
      return data ?? []
    },
    COURSE_ANN_TTL_MS
  )

  return NextResponse.json(data)
})
