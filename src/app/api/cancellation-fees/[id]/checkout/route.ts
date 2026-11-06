export const dynamic = 'force-dynamic'

// POST /api/cancellation-fees/[id]/checkout — a Stripe Checkout page for paying
// a fee the card on file couldn't cover ({ url }). The webhook marks it paid.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { feeCheckoutUrl } from '@/lib/cancellation/fees'
import { validateUUID } from '@/lib/validation'
import { logger } from '@/lib/logger'
import type { AuthContext } from '@/lib/auth/types'

export const POST = withAuth(async (
  _req: NextRequest,
  ctx: AuthContext,
  routeCtx?: { params: Record<string, string> },
) => {
  const id = routeCtx?.params?.['id'] ?? ''
  if (!validateUUID(id, 'id').valid) return NextResponse.json({ error: 'Invalid fee' }, { status: 400 })

  try {
    const url = await feeCheckoutUrl(createAdminClient(), ctx.memberId, id)
    if (!url) {
      return NextResponse.json({ error: 'This fee isn’t due.' }, { status: 409 })
    }
    return NextResponse.json({ url })
  } catch (err) {
    logger.error('Fee checkout failed', {
      action: 'cancellation_fee.checkout_failed',
      userId: ctx.userId,
      metadata: { fee_id: id, error: (err as Error).message },
    })
    return NextResponse.json({ error: 'We couldn’t open the payment page. Try again.' }, { status: 502 })
  }
}, { allowGuests: true })
