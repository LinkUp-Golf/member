export const dynamic = 'force-dynamic'

// POST /api/payments/card/setup — a SetupIntent for the Payment Element to
// confirm against ({ clientSecret }). Creates the member's Stripe customer the
// first time. Nothing is charged; the card is saved for off-session use, which
// is how a late-cancellation fee is later charged.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { createCardSetup } from '@/lib/stripe/cards'
import { logger } from '@/lib/logger'
import type { AuthContext } from '@/lib/auth/types'

export const POST = withAuth(async (_req: NextRequest, ctx: AuthContext) => {
  try {
    const setup = await createCardSetup(createAdminClient(), ctx.memberId)
    if (!setup) {
      return NextResponse.json({ error: 'Card payments aren’t set up yet.' }, { status: 503 })
    }
    return NextResponse.json(setup)
  } catch (err) {
    logger.error('Card setup failed', {
      action: 'stripe.card_setup_failed',
      userId: ctx.userId,
      metadata: { error: (err as Error).message },
    })
    return NextResponse.json({ error: 'We couldn’t start card setup. Try again.' }, { status: 502 })
  }
}, { allowGuests: true })
