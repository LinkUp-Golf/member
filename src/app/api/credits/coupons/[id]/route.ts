export const dynamic = 'force-dynamic'

// DELETE /api/credits/coupons/[id] — give back a code the member didn't use.
//
// The credit returns to their wallet and the coupon is deleted in GHL, in that
// order (see cancelCreditCoupon: the refund is withheld if the code can't be
// killed, so a live coupon is never paid back twice).

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { cancelCreditCoupon } from '@/lib/credits/coupons'
import type { AuthContext } from '@/lib/auth/types'

export const DELETE = withAuth(
  async (_req: NextRequest, ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing code id' }, { status: 400 })

    const result = await cancelCreditCoupon({
      admin: createAdminClient(),
      couponId: id,
      // Scoped to the caller: someone else's code reads as "no longer exists"
      // rather than telling them it's there.
      memberId: ctx.memberId,
      actorId: ctx.memberId,
    })

    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ ok: true, coupon: result.coupon, summary: result.summary })
  }
)
