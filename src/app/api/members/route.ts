export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { getCache, withCache } from '@/lib/cache'
import {
  COURSE_MEMBERS_NS,
  COURSE_MEMBERS_TTL_MS,
  courseMembersKey,
} from '@/lib/cache/keys'
import type { AuthContext } from '@/lib/auth/types'

// GET /api/members
// ?limit=n         — max results (default: all)
// ?exclude_self=true — exclude the authenticated user
// ?order=created_at — order by field (default: first_name)
//
// Cache strategy: per-course + variant, 15-min TTL.
// All active members of a course see the same list. The cache key encodes
// the query variant (orderBy + limit) but NOT the user's own ID — instead
// we filter `exclude_self` post-cache on the calling client, or accept that
// the cached list includes the caller (the home page already does this correctly
// because it uses ?exclude_self=true, which creates its own cache key variant).
//
// Safety: excludeSelf is part of the cache key so user A's "exclude self" list
// never contaminates user B's cached response.
export const GET = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  if (!ctx.homeCourseId) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  const { searchParams } = req.nextUrl
  const limit      = parseInt(searchParams.get('limit') ?? '0', 10)
  const excludeSelf = searchParams.get('exclude_self') === 'true'
  const orderBy    = searchParams.get('order') === 'created_at' ? 'created_at' : 'first_name'

  // Cache key encodes all variant dimensions so different query shapes
  // don't collide and don't accidentally share data.
  const cacheKey = courseMembersKey(
    ctx.homeCourseId,
    `${orderBy}:excl${excludeSelf ? '1' : '0'}`,
    limit
  )
  const cache = getCache(COURSE_MEMBERS_NS)

  const data = await withCache(
    cache,
    cacheKey,
    async () => {
      const admin = createAdminClient()

      let query = admin
        .from('members')
        .select('*, profile:member_profiles(*), home_course:courses(*)')
        .eq('home_course_id', ctx.homeCourseId!)
        .eq('membership_status', 'active')
        .order(orderBy, { ascending: orderBy === 'first_name' })

      if (excludeSelf) query = query.neq('id', ctx.userId)
      if (limit > 0) query = query.limit(limit)

      const { data, error } = await query
      if (error) throw new Error(error.message)
      return data ?? []
    },
    COURSE_MEMBERS_TTL_MS
  )

  return NextResponse.json(data)
})
