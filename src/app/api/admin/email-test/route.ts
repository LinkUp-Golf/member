// Does email work, and if not, which part doesn't.
//
// The email channel has four places to fail and only one of them is Resend:
// the key can be missing, the service-role key can fail to resolve a member's
// address, the member can have no address or no access, and only then does a
// message reach the provider. A notification triggered through the app runs
// all four at once and reports none of them, because it's void-ed on purpose
// — a notification must never fail the booking that produced it.
//
// This runs the same path deliberately and returns each stage, so a report of
// "email isn't working" is one request rather than an afternoon.
//
// Admin-only, and it does send a real email — to the caller's own address
// unless one is named.

import { NextResponse, type NextRequest } from 'next/server'
import { withAdminAuth } from '@/lib/auth/with-auth'
import type { AuthContext } from '@/lib/auth/types'
import { emailConfig, emailEnabled, maskEmail } from '@/lib/email/client'
import { memberEmails, renderNotification, sendNotificationEmail } from '@/lib/email/send'
import { logger } from '@/lib/logger'
import type { PushPayload } from '@/lib/push/types'

export const dynamic = 'force-dynamic'

const SAMPLE: PushPayload = {
  title: 'LinkUp email test',
  body: 'If this reached your inbox, the email channel is working end to end.',
  url: '/home',
  cta: 'Open LinkUp',
}

export const POST = withAdminAuth(async (req: NextRequest, ctx: AuthContext) => {
  const body = await req.json().catch(() => ({}) as Record<string, unknown>)
  const requested = typeof body.to === 'string' ? body.to.trim() : ''

  // Resolving the caller's own id exercises the member lookup — the stage that
  // fails silently when the service-role key is wrong — even when an explicit
  // address is given.
  const resolved = await memberEmails([ctx.memberId])
  const to = requested || resolved[0] || ctx.email

  const { subject, html, text } = renderNotification(SAMPLE)

  const stages: Record<string, unknown> = {
    config: emailConfig(),
    lookup: {
      memberId: ctx.memberId,
      resolvedFromDatabase: resolved.length,
      // False here with a valid key means the member row has no address or has
      // lost access; false with an invalid key means every send is a no-op.
      resolvedCallerAddress: resolved.length > 0,
    },
    message: { subject, to: maskEmail(to), htmlBytes: html.length, textBytes: text.length },
  }

  if (!emailEnabled()) {
    return NextResponse.json(
      { ok: false, reason: 'RESEND_API_KEY is not set — the channel is off', stages },
      { status: 200 },
    )
  }

  const result = await sendNotificationEmail([to], SAMPLE)

  logger.info('Email test run', {
    action: 'email.test',
    userId: ctx.memberId,
    metadata: { to: maskEmail(to), ...result },
  })

  return NextResponse.json({
    ok: result.sent > 0,
    // The provider accepted it; delivery, bounce and spam are the dashboard's
    // to report, keyed by the id on the email.sent log line.
    reason: result.sent > 0 ? 'Accepted by Resend' : 'Not sent — see stages and server logs',
    result,
    stages,
  })
})
