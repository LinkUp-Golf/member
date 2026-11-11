export const dynamic = 'force-dynamic'

// POST /api/cancellation-fees/[id]/invoice — where the member pays one of
// their fees: its Stripe invoice page ({ url }), issued now if Stripe couldn't
// be reached when they cancelled. The webhook marks it paid.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { feeInvoiceUrl } from '@/lib/cancellation/fees'
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
    const url = await feeInvoiceUrl(createAdminClient(), ctx.memberId, id)
    if (!url) {
      return NextResponse.json({ error: 'This fee isn’t due.' }, { status: 409 })
    }
    return NextResponse.json({ url })
  } catch (err) {
    logger.error('Fee invoice failed', {
      action: 'cancellation_fee.invoice_open_failed',
      userId: ctx.userId,
      metadata: { fee_id: id, error: (err as Error).message },
    })
    return NextResponse.json({ error: 'We couldn’t open the invoice. Try again.' }, { status: 502 })
  }
}, { allowGuests: true })
