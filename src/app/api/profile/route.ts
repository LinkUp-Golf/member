export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { withAuth } from '@/lib/auth/with-auth'
import { createRouteHandlerClient } from '@/lib/supabase-server'
import { getCache } from '@/lib/cache'
import { MEMBER_DETAIL_NS, memberDetailKey } from '@/lib/cache/keys'
import { parseNonprofits, MAX_NONPROFITS } from '@/lib/profile/nonprofits'
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
    'non_golf_hobbies', 'linkedin_url', 'handicap_index', 'preferred_play_times',
    'play_frequency', 'open_to_golf_travel', 'family_golfers',
    'profile_visible', 'show_handicap', 'text_size',
  ]

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  // Handled outside the whitelist loop: the client sends the textarea's raw
  // text and the stored shape is an array, so this is a parse rather than a
  // copy. Rejecting a fourth entry rather than dropping it — the member typed
  // it deliberately, and silently deleting a line they can still see in the
  // box reads as the save having failed. The DB CHECK enforces the same cap;
  // this exists so the answer is a sentence instead of a constraint violation.
  if ('nonprofits' in body) {
    const parsed = parseNonprofits(body.nonprofits as string | string[] | null)
    if (parsed.length > MAX_NONPROFITS) {
      return NextResponse.json(
        { error: `Please list up to ${MAX_NONPROFITS} non-profits — you have ${parsed.length}.` },
        { status: 400 }
      )
    }
    updates.nonprofits = parsed
  }

  const { data, error } = await supabase
    .from('member_profiles')
    .update(updates)
    .eq('id', ctx.userId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Invalidate the cached member detail so other members see the updated profile.
  await getCache(MEMBER_DETAIL_NS).delete(memberDetailKey(ctx.userId)).catch(() => {})

  return NextResponse.json(data)
})
