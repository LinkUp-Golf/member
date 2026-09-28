// Does email work, and if not, which part doesn't.
//
// The email channel has three places to fail and only one of them is Resend:
// the key can be missing, the member lookup can fail to produce an address,
// and only then does a message reach the provider. A notification triggered
// through the app runs all three and reports none of them, because it's fired
// without being awaited — a notification must never fail the booking that
// produced it.
//
// Two modes, and the difference between them is the whole point:
//
//   {}                     smoke test. Renders and sends straight to Resend,
//                          bypassing the member lookup. Proves the key, the
//                          sender domain and the template — nothing else.
//   { "memberId": "..." }  the real path: notifyMember's email half, exactly
//                          as a group invite or an approval would run it. This
//                          is the one to use when a notification didn't
//                          arrive, pointed at the member who didn't get it.
//
// A smoke test passing while the real path fails is the expected shape of a
// broken member lookup, so the two are never conflated in the result.
//
// Admin-only, and it does send a real email.

import { NextResponse, type NextRequest } from 'next/server'
import { withAdminAuth } from '@/lib/auth/with-auth'
import type { AuthContext } from '@/lib/auth/types'
import { emailConfig, emailEnabled, maskEmail } from '@/lib/email/client'
import {
  renderNotification,
  resolveRecipients,
  sendEmailToMember,
  sendNotificationEmail,
} from '@/lib/email/send'
import { logger } from '@/lib/logger'
import type { PushPayload } from '@/lib/push/types'

export const dynamic = 'force-dynamic'

const SAMPLE: PushPayload = {
  title: 'LinkUp email test',
  body: 'If this reached your inbox, the email channel is working end to end.',
  url: '/home',
  tag: 'test-notification',
  cta: 'Open LinkUp',
}

export const POST = withAdminAuth(async (req: NextRequest, ctx: AuthContext) => {
  const body = await req.json().catch(() => ({}) as Record<string, unknown>)
  const targetMemberId = typeof body.memberId === 'string' ? body.memberId.trim() : ''
  const requested = typeof body.to === 'string' ? body.to.trim() : ''

  const config = emailConfig()
  if (!emailEnabled()) {
    return NextResponse.json({
      ok: false,
      reason: 'RESEND_API_KEY is not set — the channel is off',
      stages: { config },
    })
  }

  // ---- Real path -------------------------------------------------
  if (targetMemberId) {
    const recipients = await resolveRecipients([targetMemberId])

    const stages = {
      config,
      lookup: {
        memberId: targetMemberId,
        // The usual culprit when a notification silently doesn't arrive: no
        // row, no address, or a membership status that has lost access.
        addressFound: recipients.length > 0,
        to: recipients[0] ? maskEmail(recipients[0].email) : null,
      },
    }

    if (recipients.length === 0) {
      return NextResponse.json({
        ok: false,
        mode: 'real-path',
        reason:
          'No address for this member — check the members row has an email and a membership_status other than cancelled/suspended, and that SUPABASE_SERVICE_ROLE_KEY is valid',
        stages,
      })
    }

    const result = await sendEmailToMember(targetMemberId, SAMPLE)

    logger.info('Email test run (real path)', {
      action: 'email.test',
      userId: ctx.memberId,
      metadata: { targetMemberId, ...result },
    })

    return NextResponse.json({
      ok: result.sent > 0,
      mode: 'real-path',
      reason: result.sent > 0 ? 'Accepted by Resend' : 'Not sent — see stages and server logs',
      result,
      stages,
    })
  }

  // ---- Smoke test ------------------------------------------------
  // Deliberately bypasses the member lookup, and says so, because a pass here
  // means only that Resend accepted a message from this sender.
  const resolved = await resolveRecipients([ctx.memberId])
  const to = requested || resolved[0]?.email || ctx.email

  const { subject, html, text } = renderNotification(SAMPLE)
  const result = await sendNotificationEmail([to], SAMPLE)

  logger.info('Email test run (smoke)', {
    action: 'email.test',
    userId: ctx.memberId,
    metadata: { to: maskEmail(to), callerAddressResolved: resolved.length > 0, ...result },
  })

  return NextResponse.json({
    ok: result.sent > 0,
    mode: 'smoke',
    reason: result.sent > 0 ? 'Accepted by Resend' : 'Not sent — see stages and server logs',
    // The thing a plain smoke test hides: the caller's address can come from
    // the session rather than the database, so this passes while every real
    // notification fails.
    warning:
      resolved.length === 0
        ? 'Your own member row did not resolve to an address — real notifications will not send. Re-run with {"memberId":"<id>"} to see why.'
        : null,
    result,
    stages: {
      config,
      lookup: { memberId: ctx.memberId, callerAddressResolved: resolved.length > 0 },
      message: { subject, to: maskEmail(to), htmlBytes: html.length, textBytes: text.length },
    },
  })
})
