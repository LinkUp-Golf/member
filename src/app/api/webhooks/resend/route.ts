export const dynamic = 'force-dynamic'

// POST /api/webhooks/resend
//
// What Resend tells us about mail we already sent. Two events matter and the
// rest are noise we log a count of:
//
//   email.bounced      the receiving server refused it. Permanently means the
//                      address is dead, and every further send to it is
//                      counted against our bounce rate by every provider that
//                      sees it.
//   email.complained   the reader pressed "this is spam". One complaint is a
//                      reader; a complaint rate over 0.3% is a sending domain
//                      that Gmail starts throttling, and the only fix is to
//                      stop mailing whoever complained.
//
// Both write to email_suppressions, which every send now reads (see
// @/lib/email/suppression). Without this route the table only ever gets
// unsubscribes, and the two problems that actually damage deliverability stay
// invisible.
//
// Secured by signature, not session — under /api/webhooks, which middleware
// treats as public for exactly this reason. Configure it in Resend under
// Webhooks and put the signing secret in RESEND_WEBHOOK_SECRET; with that
// unset, every delivery is rejected and logged, because a webhook that writes
// to a suppression list must never be open.

import { NextResponse, type NextRequest } from 'next/server'
import { randomUUID } from 'crypto'
import { suppress } from '@/lib/email/suppression'
import { maskEmail } from '@/lib/email/client'
import {
  eventAddresses,
  isHardBounce,
  verifySvixSignature,
  type ResendWebhookEvent,
} from '@/lib/email/webhook'
import { logger } from '@/lib/logger'

export async function POST(req: NextRequest) {
  const requestId = randomUUID()
  const log = logger.child({ requestId, action: 'resend_webhook' })

  // The raw body, byte for byte: the signature covers the text that was sent,
  // so re-serialising parsed JSON would never match.
  const body = await req.text()

  const verified = verifySvixSignature({
    headers: {
      id: req.headers.get('svix-id'),
      timestamp: req.headers.get('svix-timestamp'),
      signature: req.headers.get('svix-signature'),
    },
    body,
    secret: process.env.RESEND_WEBHOOK_SECRET,
  })

  if (!verified.ok) {
    log.warn('Resend webhook rejected', { metadata: { reason: verified.reason } })
    // 401 rather than 200: Resend retries, which is what we want if the reason
    // is a secret that hasn't been deployed yet.
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let event: ResendWebhookEvent
  try {
    event = JSON.parse(body) as ResendWebhookEvent
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const type = event.type ?? 'unknown'
  const addresses = eventAddresses(event)

  if (addresses.length === 0) {
    log.info('Resend webhook carried no addresses', { metadata: { type } })
    return NextResponse.json({ received: true, suppressed: 0 })
  }

  let suppressed = 0

  switch (type) {
    case 'email.bounced': {
      const bounce = event.data?.bounce
      if (isHardBounce(bounce?.type)) {
        suppressed = await suppress(
          addresses,
          'bounced',
          [bounce?.subType, bounce?.message].filter(Boolean).join(': ') || 'permanent bounce',
        )
      } else {
        // Worth a line. A transient bounce that keeps repeating for the same
        // address is a suppression somebody should make by hand, and this is
        // the only place it would ever show up.
        log.info('Transient bounce left unsuppressed', {
          metadata: {
            to: addresses.map(maskEmail),
            bounceType: bounce?.type ?? null,
            subType: bounce?.subType ?? null,
          },
        })
      }
      break
    }

    case 'email.complained':
      suppressed = await suppress(addresses, 'complained', 'marked as spam by the recipient')
      break

    default:
      // email.sent, .delivered, .opened, .clicked, .delivery_delayed. Resend's
      // dashboard is the record for these; repeating it here would be a second
      // one to keep in step with the first.
      break
  }

  log.info('Resend webhook handled', {
    metadata: {
      type,
      recipients: addresses.length,
      to: addresses.slice(0, 5).map(maskEmail),
      suppressed,
      emailId: event.data?.email_id ?? null,
    },
  })

  return NextResponse.json({ received: true, suppressed })
}
