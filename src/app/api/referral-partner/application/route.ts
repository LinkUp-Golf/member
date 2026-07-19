export const dynamic = 'force-dynamic'

// GET  /api/referral-partner/application — the caller's application status,
//        plus their partner row once approved.
// POST /api/referral-partner/application — apply to become a referral partner.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { validateString, sanitiseText } from '@/lib/validation'
import { logger } from '@/lib/logger'
import type { AuthContext } from '@/lib/auth/types'

export const GET = withAuth(async (_req: NextRequest, ctx: AuthContext) => {
  const admin = createAdminClient()

  // Most recent application — the member may have been rejected and re-applied.
  const { data: application } = await admin
    .from('referral_partner_applications')
    .select('*')
    .eq('member_id', ctx.memberId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // The partner row is the role itself, so report it independently of the
  // application — an admin can grant the role without an application existing.
  const { data: partner } = await admin
    .from('referral_partners')
    .select('id, name, code, percentage, ends_at')
    .eq('member_id', ctx.memberId)
    .maybeSingle()

  return NextResponse.json({ application: application ?? null, partner: partner ?? null })
})

export const POST = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  const body = await req.json().catch(() => ({})) as { motivation?: string }

  const motivation = body.motivation?.trim() ?? ''
  const { valid, errors } = validateString(motivation, 'Motivation', { min: 20, max: 1000 })
  if (!valid) return NextResponse.json({ error: errors[0] }, { status: 400 })

  const admin = createAdminClient()

  // Already a partner — nothing to apply for.
  const { data: existingPartner } = await admin
    .from('referral_partners')
    .select('id')
    .eq('member_id', ctx.memberId)
    .maybeSingle()
  if (existingPartner) {
    return NextResponse.json({ error: 'You are already a referral partner.' }, { status: 409 })
  }

  // Re-applying while a review is open is a no-op, not a duplicate row. The
  // partial unique index is the race-safe backstop for this check.
  const { data: pending } = await admin
    .from('referral_partner_applications')
    .select('id')
    .eq('member_id', ctx.memberId)
    .eq('status', 'pending')
    .maybeSingle()
  if (pending) {
    return NextResponse.json({ error: 'You already have an application under review.' }, { status: 409 })
  }

  const { data, error } = await admin
    .from('referral_partner_applications')
    .insert({ member_id: ctx.memberId, motivation: sanitiseText(motivation) })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'You already have an application under review.' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  logger.info('Referral partner application submitted', {
    action: 'referral_partner.application.submitted',
    userId: ctx.userId,
    metadata: { application_id: data.id },
  })

  return NextResponse.json({ application: data }, { status: 201 })
})
