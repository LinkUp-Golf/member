export const dynamic = 'force-dynamic'

// POST /api/partner/credits/redeem — spend available credit toward golf.
// Shares redeemCredit with the host workspace; all this route decides is who's
// allowed in.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withPartnerAuth, type PartnerAuthContext } from '@/lib/auth/with-partner-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { redeemCredit } from '@/lib/credits/redeem'

export const POST = withPartnerAuth(async (req: NextRequest, ctx: PartnerAuthContext) => {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>

  const result = await redeemCredit({
    admin: createAdminClient(),
    memberId: ctx.memberId,
    actorName: ctx.partner.name,
    amount: body.amount,
    purpose: body.purpose,
    note: body.note,
    context: { partner_id: ctx.partner.id },
  })

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true, summary: result.summary })
})
