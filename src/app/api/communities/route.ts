export const dynamic = 'force-dynamic'

// GET /api/communities
//
// The active communities, for the location filter on /book and the member
// directory (src/components/communities/CommunityFilter.tsx). Name and slug
// only: who captains a community is admin business. Any signed-in member.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import type { AuthContext } from '@/lib/auth/types'

export const GET = withAuth(async (_req: NextRequest, _ctx: AuthContext) => {
  const { data, error } = await createAdminClient()
    .from('communities')
    .select('id, name, slug')
    .eq('active', true)
    .order('name')

  // A missing table (not migrated yet) reads as no communities: the filter
  // simply doesn't show.
  if (error) return NextResponse.json({ communities: [] })
  return NextResponse.json({ communities: data ?? [] })
})
