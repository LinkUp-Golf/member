export const dynamic = 'force-dynamic'

// The signed-in member's own row, joined with their profile and home course —
// what ProfileContext holds and every screen reads `profile` / `is_admin` from.
//
// It used to be read in the browser through the Supabase client. When that
// client's session stalled or went stale (an auth lock held by another tab, a
// token refresh that never settled — common in an installed PWA) the query
// never resolved, while every API route kept working off the cookie. The
// result was a member who could use the app but whose Profile screen painted
// nothing and whose menu had lost its Admin entry. Reading it here ties it to
// the same cookie session the middleware and every other route use.
//
// skipGHLCheck: this returns only the caller's own row, and the membership gate
// is enforced by the routes that do things. Failing it closed when GHL is slow
// would blank the profile and hide Admin for an outage that isn't ours.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { withAuth } from '@/lib/auth/with-auth'
import { createRouteHandlerClient } from '@/lib/supabase-server'
import type { AuthContext } from '@/lib/auth/types'

export const GET = withAuth(async (_req: NextRequest, ctx: AuthContext) => {
  const supabase = createRouteHandlerClient(cookies())

  const { data, error } = await supabase
    .from('members')
    .select('*, profile:member_profiles(*), home_course:courses!members_home_course_id_fkey(*)')
    .eq('id', ctx.userId)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Failed to load profile' }, { status: 500 })
  }

  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
}, { allowGuests: true, skipGHLCheck: true })
