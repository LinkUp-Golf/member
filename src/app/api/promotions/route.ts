export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { withAuth } from '@/lib/auth/with-auth'
import { createRouteHandlerClient } from '@/lib/supabase-server'
import type { AuthContext } from '@/lib/auth/types'

// GET /api/promotions
// ?limit=n   — max results (default: all)
export const GET = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  const supabase = createRouteHandlerClient(cookies())
  const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '0', 10)

  const { data: member } = await supabase
    .from('members').select('home_course_id').eq('id', ctx.userId).single()

  if (!member?.home_course_id) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  let query = supabase
    .from('promotions')
    .select('*')
    .eq('active', true)
    .or(`course_id.is.null,course_id.eq.${member.home_course_id}`)
    .order('sort_order', { ascending: true })

  if (limit > 0) query = query.limit(limit)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
})
