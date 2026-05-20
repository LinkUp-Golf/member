import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { withAuth } from '@/lib/auth/with-auth'
import { createRouteHandlerClient } from '@/lib/supabase-server'
import type { AuthContext } from '@/lib/auth/types'

// GET /api/focus-linkups — upcoming focus linkups + user subscriptions
export const GET = withAuth(async (_req: NextRequest, ctx: AuthContext) => {
  const supabase = createRouteHandlerClient(cookies())
  const today = new Date().toISOString().slice(0, 10)

  const { data: member } = await supabase
    .from('members').select('home_course_id').eq('id', ctx.userId).single()

  if (!member?.home_course_id) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  const [linkupsRes, subsRes] = await Promise.all([
    supabase
      .from('focus_linkups')
      .select('*')
      .eq('course_id', member.home_course_id)
      .gte('focus_date', today)
      .order('focus_date', { ascending: true })
      .limit(10),

    supabase
      .from('focus_linkup_subscriptions')
      .select('industry_focus')
      .eq('member_id', ctx.userId),
  ])

  return NextResponse.json({
    linkups: linkupsRes.data ?? [],
    subscriptions: subsRes.data?.map(s => s.industry_focus) ?? [],
  })
})
