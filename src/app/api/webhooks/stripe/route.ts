export const dynamic = 'force-dynamic'

// POST /api/webhooks/stripe
//
// What Stripe tells us after the fact. Almost every late-cancellation fee is
// settled synchronously, in the cancel request itself (collectCancellationFee).
// This covers the rest:
//
//   checkout.session.completed      a member paid an unpaid fee through the
//                                   Checkout page /more/payments sends them to.
//   payment_intent.succeeded        the same, from the PaymentIntent's side — and
//                                   a direct charge Stripe was still processing
//                                   when the cancel returned.
//   payment_intent.payment_failed   that processing charge failed after all.
//   setup_intent.succeeded          a card saved through a flow that left the
//                                   page (a bank's 3-D Secure redirect), so the
//                                   client never got to POST it back.
//
// Every fee-related object carries the fee's id in its metadata
// (FEE_METADATA_KEY), so nothing here has to look a fee up by anything else.
// Each handler is idempotent: Stripe delivers at least once, and a Checkout
// payment fires both of the first two events for one fee.
//
// Secured by signature, not session — under /api/webhooks, which middleware
// treats as public. Add the endpoint in the Stripe dashboard with the four
// events above and put its signing secret in STRIPE_WEBHOOK_SECRET; with that
// unset every delivery is rejected, because this route marks money as received.

import { NextResponse, type NextRequest } from 'next/server'
import { randomUUID } from 'crypto'
import type Stripe from 'stripe'
import { getStripe } from '@/lib/stripe/client'
import { saveCardFromSetupIntent } from '@/lib/stripe/cards'
import { FEE_METADATA_KEY, settleFeeFailed, settleFeePaid } from '@/lib/cancellation/fees'
import { createAdminClient } from '@/lib/supabase-server'
import { logger } from '@/lib/logger'

export async function POST(req: NextRequest) {
  const requestId = randomUUID()
  const log = logger.child({ requestId, action: 'stripe_webhook' })

  const stripe = getStripe()
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  const signature = req.headers.get('stripe-signature')
  if (!stripe || !secret || !signature) {
    log.warn('Stripe webhook rejected', {
      metadata: { reason: !stripe ? 'stripe_unconfigured' : !secret ? 'no_secret' : 'no_signature' },
    })
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  // The raw body, byte for byte: the signature covers the text that was sent.
  const body = await req.text()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, signature, secret)
  } catch (err) {
    log.warn('Stripe webhook rejected', { metadata: { reason: (err as Error).message } })
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const admin = createAdminClient()

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object
        const feeId = session.metadata?.[FEE_METADATA_KEY]
        if (feeId && session.payment_status === 'paid') {
          const pi = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null
          await settleFeePaid(admin, feeId, pi)
        }
        break
      }
      case 'payment_intent.succeeded': {
        const intent = event.data.object
        const feeId = intent.metadata?.[FEE_METADATA_KEY]
        if (feeId) await settleFeePaid(admin, feeId, intent.id)
        break
      }
      case 'payment_intent.payment_failed': {
        const intent = event.data.object
        const feeId = intent.metadata?.[FEE_METADATA_KEY]
        if (feeId) {
          const reason = intent.last_payment_error?.decline_code ?? intent.last_payment_error?.code ?? 'payment_failed'
          await settleFeeFailed(admin, feeId, reason)
        }
        break
      }
      case 'setup_intent.succeeded': {
        const intent = event.data.object
        const memberId = intent.metadata?.member_id
        if (memberId) await saveCardFromSetupIntent(admin, memberId, intent.id, { onlyIfEmpty: true })
        break
      }
      default:
        break
    }
  } catch (err) {
    // 500 so Stripe retries: a write that failed here is money we haven't
    // recorded as received.
    log.error('Stripe webhook handling failed', {
      metadata: { type: event.type, id: event.id, error: (err as Error).message },
    })
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
