export const dynamic = 'force-dynamic'

// GET  /api/payments/card — the member's card on file, and whether the
//        cancellation policy is on at all ({ enabled, card }). `enabled` false
//        means Stripe isn't configured: no card is asked for and no fee charged.
// POST /api/payments/card — { setupIntentId }: adopt the card the Payment
//        Element just confirmed as the member's card on file. Editing a card is
//        this too: a new card replaces the old, which is detached.
// DELETE /api/payments/card — remove the card. Refused (409, card_in_use) while
//        it guarantees an upcoming round the policy covers: a card that could
//        be dropped once the round was booked would make the late fee optional.
//
// Open to guests: a guest holds a seat on someone's round, can cancel it, and so
// can owe a fee and needs somewhere to pay it.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { stripeEnabled } from '@/lib/stripe/client'
import { loadCard, removeCard, roundsHeldByCard, saveCardFromSetupIntent } from '@/lib/stripe/cards'
import { CARD_IN_USE_CODE, cardInUseMessage } from '@/lib/stripe/card'
import { logger } from '@/lib/logger'
import type { AuthContext } from '@/lib/auth/types'

export const GET = withAuth(async (_req: NextRequest, ctx: AuthContext) => {
  if (!stripeEnabled()) return NextResponse.json({ enabled: false, card: null })
  const card = await loadCard(createAdminClient(), ctx.memberId)
  return NextResponse.json({ enabled: true, card })
}, { allowGuests: true })

export const POST = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  if (!stripeEnabled()) {
    return NextResponse.json({ error: 'Card payments aren’t set up yet.' }, { status: 503 })
  }

  const body = await req.json().catch(() => ({})) as { setupIntentId?: unknown }
  const setupIntentId = typeof body.setupIntentId === 'string' ? body.setupIntentId : ''
  if (!/^seti_[A-Za-z0-9]+$/.test(setupIntentId)) {
    return NextResponse.json({ error: 'Missing setupIntentId' }, { status: 400 })
  }

  try {
    const card = await saveCardFromSetupIntent(createAdminClient(), ctx.memberId, setupIntentId)
    if (!card) {
      return NextResponse.json({ error: 'We couldn’t save that card. Try entering it again.' }, { status: 400 })
    }
    return NextResponse.json({ card })
  } catch (err) {
    logger.error('Saving a card failed', {
      action: 'stripe.save_card_failed',
      userId: ctx.userId,
      metadata: { error: (err as Error).message },
    })
    return NextResponse.json({ error: 'We couldn’t save that card. Try again.' }, { status: 500 })
  }
}, { allowGuests: true })

export const DELETE = withAuth(async (_req: NextRequest, ctx: AuthContext) => {
  if (!stripeEnabled()) {
    return NextResponse.json({ error: 'Card payments aren’t set up yet.' }, { status: 503 })
  }

  const admin = createAdminClient()
  try {
    const rounds = await roundsHeldByCard(admin, ctx.memberId)
    if (rounds > 0) {
      return NextResponse.json(
        { error: cardInUseMessage(rounds), code: CARD_IN_USE_CODE },
        { status: 409 },
      )
    }
    await removeCard(admin, ctx.memberId)
    return NextResponse.json({ card: null })
  } catch (err) {
    logger.error('Removing a card failed', {
      action: 'stripe.remove_card_failed',
      userId: ctx.userId,
      metadata: { error: (err as Error).message },
    })
    return NextResponse.json({ error: 'We couldn’t remove that card. Try again.' }, { status: 500 })
  }
}, { allowGuests: true })
