export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { withAuth } from '@/lib/auth/with-auth'
import { createRouteHandlerClient, createAdminClient } from '@/lib/supabase-server'
import type { AuthContext } from '@/lib/auth/types'

// GET /api/members
// ?limit=n         — max results (default: all)
// ?exclude_self=true — exclude the authenticated user
// ?order=created_at — order by field (default: first_name)
export const GET = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  const supabase = createRouteHandlerClient(cookies())
  const { searchParams } = req.nextUrl
  const limit = parseInt(searchParams.get('limit') ?? '0', 10)
  const excludeSelf = searchParams.get('exclude_self') === 'true'
  const orderBy = searchParams.get('order') === 'created_at' ? 'created_at' : 'first_name'

  // Use the session client only to look up the caller's own row (RLS: id = auth.uid())
  const { data: member } = await supabase
    .from('members').select('home_course_id').eq('id', ctx.userId).single()

  if (!member?.home_course_id) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  // Use the admin client for the list query so all active members of the
  // course are returned regardless of whether course_memberships rows exist.
  // Authentication is already enforced by withAuth above.
  const admin = createAdminClient()

  let query = admin
    .from('members')
    .select('*, profile:member_profiles(*), home_course:courses(*)')
    .eq('home_course_id', member.home_course_id)
    .eq('membership_status', 'active')
    .order(orderBy, { ascending: orderBy === 'first_name' })

  if (excludeSelf) query = query.neq('id', ctx.userId)
  if (limit > 0) query = query.limit(limit)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
})
