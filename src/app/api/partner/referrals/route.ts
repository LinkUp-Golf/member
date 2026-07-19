export const dynamic = 'force-dynamic'

// GET /api/partner/referrals — the caller's own referred contacts.
// Read-only: partners see who they've referred and whether each has become a
// paying member, but referring new contacts stays an admin action.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withPartnerAuth, type PartnerAuthContext } from '@/lib/auth/with-partner-auth'
import { createAdminClient } from '@/lib/supabase-server'

export const GET = withPartnerAuth(async (_req: NextRequest, ctx: PartnerAuthContext) => {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('referral_partner_links')
    .select('*, member:members(first_name, last_name, email, membership_status)')
    .eq('referral_partner_id', ctx.partner.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ links: data ?? [] })
})
