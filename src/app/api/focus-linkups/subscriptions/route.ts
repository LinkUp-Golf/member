export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { withAuth } from '@/lib/auth/with-auth'
import { createRouteHandlerClient } from '@/lib/supabase-server'
import type { AuthContext } from '@/lib/auth/types'

const MAX_SUBSCRIPTIONS = 3

// POST /api/focus-linkups/subscriptions   body: { industry_focus, custom_label? }
export const POST = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  const supabase = createRouteHandlerClient(cookies())
  const { industry_focus, custom_label } = await req.json() as {
    industry_focus: string
    custom_label?: string
  }

  if (!industry_focus) {
    return NextResponse.json({ error: 'industry_focus is required' }, { status: 400 })
  }

  if (industry_focus === 'Other' && (!custom_label || !custom_label.trim())) {
    return NextResponse.json({ error: 'custom_label is required for custom groups' }, { status: 400 })
  }

  // Enforce max: count pending + approved only (declined don't take up a slot)
  const { count } = await supabase
    .from('focus_linkup_subscriptions')
    .select('id', { count: 'exact', head: true })
    .eq('member_id', ctx.userId)
    .in('status', ['pending', 'approved'])

  if ((count ?? 0) >= MAX_SUBSCRIPTIONS) {
    return NextResponse.json(
      { error: `Maximum of ${MAX_SUBSCRIPTIONS} Focus LinkUp groups allowed` },
      { status: 400 }
    )
  }

  const isCustom = industry_focus === 'Other'

  const { data, error } = await supabase
    .from('focus_linkup_subscriptions')
    .insert({
      member_id: ctx.userId,
      industry_focus,
      custom_label: isCustom ? (custom_label!.trim()) : null,
      status: isCustom ? 'pending' : 'approved',
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: isCustom ? 'You already have a group with that name' : 'Already subscribed to this group' },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ id: data.id, status: isCustom ? 'pending' : 'approved' }, { status: 201 })
})

// PATCH /api/focus-linkups/subscriptions   body: { id, custom_label }
// Editing a custom group resets status to pending for re-review.
export const PATCH = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  const supabase = createRouteHandlerClient(cookies())
  const { id, custom_label } = await req.json() as { id: string; custom_label: string }

  if (!id || !custom_label?.trim()) {
    return NextResponse.json({ error: 'id and custom_label are required' }, { status: 400 })
  }

  const { error } = await supabase
    .from('focus_linkup_subscriptions')
    .update({
      custom_label: custom_label.trim(),
      status: 'pending',
      reviewed_at: null,
      reviewed_by: null,
    })
    .eq('id', id)
    .eq('member_id', ctx.userId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
})

// DELETE /api/focus-linkups/subscriptions   body: { id } | { industry_focus }
// Use `id` for custom groups (multiple Other rows per member possible).
// Use `industry_focus` for standard categories (still unique per member).
export const DELETE = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  const supabase = createRouteHandlerClient(cookies())
  const body = await req.json() as { id?: string; industry_focus?: string }

  if (body.id) {
    const { error } = await supabase
      .from('focus_linkup_subscriptions')
      .delete()
      .eq('id', body.id)
      .eq('member_id', ctx.userId)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return new NextResponse(null, { status: 204 })
  }

  if (body.industry_focus) {
    const { error } = await supabase
      .from('focus_linkup_subscriptions')
      .delete()
      .eq('member_id', ctx.userId)
      .eq('industry_focus', body.industry_focus)
      .is('custom_label', null)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return new NextResponse(null, { status: 204 })
  }

  return NextResponse.json({ error: 'id or industry_focus is required' }, { status: 400 })
})
