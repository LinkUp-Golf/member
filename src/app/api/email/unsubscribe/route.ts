export const dynamic = 'force-dynamic'

// GET/POST /api/email/unsubscribe?t=<token>
//
// The way out of LinkUp's emails, reachable from an inbox and nowhere else.
// Public by necessity: the reader may have no session, no app installed and no
// intention of getting one, and requiring any of those is how an unsubscribe
// becomes a spam complaint. The token in the query string carries the address
// and a signature over it (see @/lib/email/unsubscribe), so this authenticates
// the request without authenticating a person.
//
// POST is the one a mail client sends by itself, because the messages advertise
// List-Unsubscribe-Post: List-Unsubscribe=One-Click (RFC 8058). It must act
// immediately and answer 200 — no confirmation page, no questions. Gmail and
// Yahoo have required this of bulk senders since February 2024.
//
// GET is the same action for a human who clicked the footer link, and answers
// with a page saying what just happened. It acts on the GET rather than showing
// a confirm button on purpose: a mail client that prefetches links would
// otherwise show the reader a button they never pressed and leave them
// subscribed, and the signed token means a prefetch can only ever unsubscribe
// the address the mail was sent to.

import { NextResponse, type NextRequest } from 'next/server'
import { verifyUnsubscribeToken } from '@/lib/email/unsubscribe'
import { suppress } from '@/lib/email/suppression'
import { maskEmail } from '@/lib/email/client'
import { logger } from '@/lib/logger'

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.linkup.golf').replace(/\/+$/, '')

async function act(req: NextRequest, via: 'link' | 'one-click'): Promise<string | null> {
  const address = verifyUnsubscribeToken(req.nextUrl.searchParams.get('t'))
  if (!address) {
    logger.warn('Unsubscribe rejected: token missing or not ours', {
      action: 'email.unsubscribe_invalid',
      metadata: { via },
    })
    return null
  }

  await suppress([address], 'unsubscribed', `via ${via}`)
  logger.info('Member unsubscribed from email', {
    action: 'email.unsubscribed',
    metadata: { via, to: maskEmail(address) },
  })
  return address
}

/** The mail client's own button. Nothing is rendered; only the status matters. */
export async function POST(req: NextRequest) {
  const address = await act(req, 'one-click')
  // 200 either way. A client that gets an error here may show the reader that
  // unsubscribing failed, and the next thing they press is "report spam" —
  // which costs the sending domain far more than a replayed token does.
  return NextResponse.json({ unsubscribed: !!address })
}

/** The footer link, clicked by a person. */
export async function GET(req: NextRequest) {
  const address = await act(req, 'link')
  return new NextResponse(page(address), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Nothing about this belongs in a shared cache, and a cached "you're
      // unsubscribed" served to the next reader would be a lie.
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  })
}

/**
 * A page, not a redirect into the app.
 *
 * Whoever is reading this may not be a member any more, may never have
 * installed the app, and has just asked to hear less from us — answering with
 * a login wall would be the wrong reply to that request. Self-contained so it
 * renders with nothing else loaded.
 */
function page(address: string | null): string {
  const heading = address ? "You're unsubscribed" : "That link didn't work"
  const message = address
    ? `We've stopped sending email to ${escapeHtml(address)}. Notifications in the app are unaffected — you can turn those off under Settings.`
    : 'The link may have been altered on its way here. If you still want to stop receiving email from us, reply to any LinkUp message and we will take care of it.'

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>${heading} &middot; LinkUp Golf</title>
</head>
<body style="margin:0;background:#F8F8FC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#555355;">
  <div style="max-width:520px;margin:0 auto;padding:64px 24px;">
    <div style="background:#fff;border:1px solid #DDE5F5;border-radius:20px;padding:28px 24px;">
      <div style="height:4px;width:44px;background:#85bb65;border-radius:2px;margin-bottom:20px;"></div>
      <h1 style="margin:0 0 10px;font-size:20px;line-height:1.3;color:#001040;">${heading}</h1>
      <p style="margin:0 0 20px;font-size:14px;line-height:22px;">${message}</p>
      <a href="${APP_URL}" style="display:inline-block;background:#002669;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 20px;border-radius:999px;">Open LinkUp</a>
    </div>
  </div>
</body>
</html>`
}

/** The address is ours, but it still ends up inside markup. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
