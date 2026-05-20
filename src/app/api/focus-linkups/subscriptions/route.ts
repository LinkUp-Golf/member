import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { withAuth } from '@/lib/auth/with-auth'
import { createRouteHandlerClient } from '@/lib/supabase-server'
import type { AuthContext } from '@/lib/auth/types'

// POST /api/focus-linkups/subscriptions   body: { industry_focus }
export const POST = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  const supabase = createRouteHandlerClient(cookies())
  const { industry_focus } = await req.json() as { industry_focus: string }

  if (!industry_focus) {
    return NextResponse.json({ error: 'industry_focus is required' }, { status: 400 })
  }

  const { error } = await supabase
    .from('focus_linkup_subscriptions')
    .insert({ member_id: ctx.userId, industry_focus })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true }, { status: 201 })
})

// DELETE /api/focus-linkups/subscriptions   body: { industry_focus }
export const DELETE = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  const supabase = createRouteHandlerClient(cookies())
  const { industry_focus } = await req.json() as { industry_focus: string }

  if (!industry_focus) {
    return NextResponse.json({ error: 'industry_focus is required' }, { status: 400 })
  }

  const { error } = await supabase
    .from('focus_linkup_subscriptions')
    .delete()
    .eq('member_id', ctx.userId)
    .eq('industry_focus', industry_focus)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return new NextResponse(null, { status: 204 })
})
