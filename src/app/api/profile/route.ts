import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { withAuth } from '@/lib/auth/with-auth'
import { createRouteHandlerClient } from '@/lib/supabase-server'
import type { AuthContext } from '@/lib/auth/types'

export const GET = withAuth(async (_req: NextRequest, ctx: AuthContext) => {
  const supabase = createRouteHandlerClient(cookies())

  const { data, error } = await supabase
    .from('member_profiles')
    .select('*')
    .eq('id', ctx.userId)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
})

export const PATCH = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  const supabase = createRouteHandlerClient(cookies())
  const body = await req.json() as Record<string, unknown>

  // Whitelist updatable fields — prevent overwriting id or system fields
  const allowed = [
    'display_name', 'avatar_url', 'business_name', 'business_description',
    'role_title', 'industry_category', 'value_offered', 'value_sought',
    'non_golf_hobbies', 'handicap_index', 'preferred_play_times',
    'play_frequency', 'open_to_golf_travel', 'family_golfers',
    'profile_visible', 'show_handicap',
  ]

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  const { data, error } = await supabase
    .from('member_profiles')
    .update(updates)
    .eq('id', ctx.userId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
})
