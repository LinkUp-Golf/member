export const dynamic = 'force-dynamic'

// POST /api/host/credits/redeem — spend available credit toward golf.
// The money handling lives in redeemCredit so this and the partner workspace's
// equivalent can't drift; all this route decides is who's allowed in.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withHostAuth, type HostAuthContext } from '@/lib/auth/with-host-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { redeemCredit } from '@/lib/credits/redeem'

export const POST = withHostAuth(async (req: NextRequest, ctx: HostAuthContext) => {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>

  const result = await redeemCredit({
    admin: createAdminClient(),
    memberId: ctx.memberId,
    actorName: ctx.host.name,
    amount: body.amount,
    purpose: body.purpose,
    note: body.note,
    context: { host_id: ctx.host.id },
  })

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true, summary: result.summary })
})
