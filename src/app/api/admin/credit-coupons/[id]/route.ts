export const dynamic = 'force-dynamic'

// DELETE /api/admin/credit-coupons/[id] — cancel a code on the member's behalf
// and refund the credit.
//
// The member can do this themselves; an admin needs it for the cases they
// can't — a code issued against a booking that got cancelled, or one a member
// phones in about. Same function, so the refund and the GHL cleanup can't drift
// between the two paths.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { cancelCreditCoupon } from '@/lib/credits/coupons'
import type { AuthContext } from '@/lib/auth/types'

export const DELETE = withAuth(
  async (req: NextRequest, ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing code id' }, { status: 400 })

    const body = await req.json().catch(() => ({})) as { reason?: string }

    const result = await cancelCreditCoupon({
      admin: createAdminClient(),
      couponId: id,
      // No memberId: an admin acts on any code. The refund still lands in the
      // wallet the code came out of.
      actorId: ctx.userId,
      reason: typeof body.reason === 'string' ? body.reason : null,
    })

    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ ok: true, coupon: result.coupon, summary: result.summary })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
