export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import type { AuthContext } from '@/lib/auth/types'

export const GET = withAuth(
  async (req: NextRequest, _ctx: AuthContext) => {
    const courseId = new URL(req.url).searchParams.get('courseId')

    const admin = createAdminClient()
    let query = admin
      .from('event_access_requests')
      .select('*, member:members!member_id(first_name, last_name, email), course:courses(name, access_tag)')
      .order('created_at', { ascending: false })
    if (courseId) query = query.eq('course_id', courseId)

    const { data, error } = await query

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ requests: data ?? [] })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
