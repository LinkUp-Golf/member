import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { withAuth } from '@/lib/auth/with-auth'
import { createRouteHandlerClient } from '@/lib/supabase-server'
import type { AuthContext } from '@/lib/auth/types'

// GET /api/announcements
// ?limit=n   — max results (default: 50)
export const GET = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  const supabase = createRouteHandlerClient(cookies())
  const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '50', 10)

  const { data: member } = await supabase
    .from('members').select('home_course_id').eq('id', ctx.userId).single()

  if (!member?.home_course_id) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  const { data, error } = await supabase
    .from('announcements')
    .select('*')
    .eq('course_id', member.home_course_id)
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(limit)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
})
