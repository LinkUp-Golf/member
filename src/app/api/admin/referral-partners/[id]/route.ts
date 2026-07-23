export const dynamic = 'force-dynamic'

// PATCH  /api/admin/referral-partners/[id]  — update name / code / percentage
// DELETE /api/admin/referral-partners/[id]  — delete partner (links cascade)

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { validateReferralPartnerPayload } from '@/lib/validation'
import type { AuthContext } from '@/lib/auth/types'
import type { ReferralPartner } from '@/types'

export const PATCH = withAuth(
  async (req: NextRequest, _ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing partner id' }, { status: 400 })

    const body = await req.json() as Partial<ReferralPartner>

    // Validate only the fields present (partial update)
    const { valid, errors } = validateReferralPartnerPayload(body, { partial: true })
    if (!valid) return NextResponse.json({ error: errors[0] }, { status: 400 })

    if (body.payout_method != null && body.payout_method !== 'cash' && body.payout_method !== 'coupon') {
      return NextResponse.json({ error: 'payout_method must be cash or coupon' }, { status: 400 })
    }

    const admin = createAdminClient()

    const allowed: Array<keyof ReferralPartner> = ['name', 'code', 'percentage', 'ends_at', 'payout_method']
    const updates: Record<string, unknown> = {}
    for (const key of allowed) {
      if (key in body) updates[key] = body[key]
    }
    if (typeof updates.name === 'string') updates.name = updates.name.trim()
    if (typeof updates.code === 'string') updates.code = updates.code.trim()
    // Empty string from the date input clears the expiry rather than failing.
    if (typeof updates.ends_at === 'string' && !updates.ends_at.trim()) updates.ends_at = null
    if (!Object.keys(updates).length) return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    updates.updated_at = new Date().toISOString()

    // Code uniqueness on edit
    if (typeof updates.code === 'string') {
      const { data: conflict } = await admin
        .from('referral_partners').select('id').eq('code', updates.code).neq('id', id).limit(1)
      if (conflict?.length) {
        return NextResponse.json({ error: `The code "${updates.code}" is already taken. Choose a different one.` }, { status: 409 })
      }
    }

    const { data, error } = await admin
      .from('referral_partners').update(updates).eq('id', id).select().single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: `That code is already taken. Choose a different one.` }, { status: 409 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ partner: data })
  },
  { requireAdmin: true, skipGHLCheck: true }
)

export const DELETE = withAuth(
  async (_req: NextRequest, _ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing partner id' }, { status: 400 })

    const admin = createAdminClient()

    // Links cascade-delete via FK. Attribution is DB-only, so linked GHL
    // contacts (leads) are left untouched.
    const { error } = await admin.from('referral_partners').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
