export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { getCache, withCache } from '@/lib/cache'
import {
  COURSE_PROMO_NS,
  COURSE_PROMO_TTL_MS,
  coursePromoKey,
} from '@/lib/cache/keys'
import type { AuthContext } from '@/lib/auth/types'

// GET /api/promotions
// ?limit=n   — max results (default: all)
//
// Cache strategy: per-course, 30-min TTL.
// Promotions are admin-managed and change infrequently.
// Cached data is the same for all course members.
// Invalidated by admin create/update/delete.
export const GET = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  if (!ctx.homeCourseId) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '0', 10)
  const cache = getCache(COURSE_PROMO_NS)
  const key   = coursePromoKey(ctx.homeCourseId, limit)

  const data = await withCache(
    cache,
    key,
    async () => {
      const admin = createAdminClient()
      let query = admin
        .from('promotions')
        .select('*')
        .eq('active', true)
        .or(`course_id.is.null,course_id.eq.${ctx.homeCourseId}`)
        .order('sort_order', { ascending: true })

      if (limit > 0) query = query.limit(limit)

      const { data, error } = await query
      if (error) throw new Error(error.message)
      return data ?? []
    },
    COURSE_PROMO_TTL_MS
  )

  return NextResponse.json(data)
})
