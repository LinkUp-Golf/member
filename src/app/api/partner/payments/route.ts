export const dynamic = 'force-dynamic'

// GET /api/partner/payments — the caller's own commission ledger: what each
// month earned, what's been paid, and what's still outstanding.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withPartnerAuth, type PartnerAuthContext } from '@/lib/auth/with-partner-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { loadPayoutSummary } from '@/lib/referral-payouts'

export const GET = withPartnerAuth(async (_req: NextRequest, ctx: PartnerAuthContext) => {
  const admin = createAdminClient()
  const summary = await loadPayoutSummary(admin, ctx.partner)
  return NextResponse.json({ partner: ctx.partner, ...summary })
})
