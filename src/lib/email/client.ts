// Resend, and the one place that knows whether email is switched on.
//
// Server-only. The client is built lazily, like the GHL and Supabase clients,
// so a missing key is a disabled channel rather than a process that won't boot
// — tests, local work and preview deploys run without RESEND_API_KEY and simply
// don't send.
//
// Nothing here throws. An email is the second way a member hears about
// something they were already pushed; a notification failing must never fail
// the booking, approval or payout that produced it.

import { Resend } from 'resend'
import { logger } from '@/lib/logger'

let _client: Resend | null = null

/** Configured only when there's a key to send with. */
export const emailEnabled = (): boolean => !!process.env.RESEND_API_KEY

function getClient(): Resend | null {
  if (!emailEnabled()) return null
  if (!_client) _client = new Resend(process.env.RESEND_API_KEY as string)
  return _client
}

/**
 * Who the email comes from. A verified domain in Resend — an unverified one is
 * accepted by the API and then silently dropped or junked, which is the worst
 * of both. Falls back to Resend's own sandbox sender so a first-run setup gets
 * something delivered rather than nothing.
 */
const from = (): string => process.env.EMAIL_FROM || 'LinkUp Golf <onboarding@resend.dev>'

/** Where a reply goes, when it shouldn't go to the sending address. */
const replyTo = (): string | undefined => process.env.EMAIL_REPLY_TO || undefined

export interface EmailMessage {
  to: string[]
  subject: string
  html: string
  text: string
}

export interface EmailSendResult {
  sent: number
  failed: number
  /** True when there's no API key — not a failure, just a channel that's off. */
  skipped: boolean
}

/**
 * Sends one message.
 *
 * Recipients go in `bcc` when there's more than one, so a course-wide
 * notification can't hand every member the address book. Resend caps a single
 * call at 50 addresses, so callers batch (see ./send).
 */
export async function sendEmail(message: EmailMessage): Promise<EmailSendResult> {
  const recipients = Array.from(new Set(message.to.filter(Boolean)))
  if (recipients.length === 0) return { sent: 0, failed: 0, skipped: false }

  const client = getClient()
  if (!client) {
    logger.info('Email not sent: RESEND_API_KEY is not set', {
      action: 'email.skipped',
      metadata: { recipients: recipients.length, subject: message.subject },
    })
    return { sent: 0, failed: 0, skipped: true }
  }

  const single = recipients.length === 1

  try {
    const { data, error } = await client.emails.send({
      from: from(),
      // One recipient goes in `to` so the member sees their own address; a
      // group goes to the sender with everyone bcc'd, which is what keeps one
      // member's email off another's screen.
      to: single ? recipients : [from()],
      ...(single ? {} : { bcc: recipients }),
      ...(replyTo() ? { replyTo: replyTo() as string } : {}),
      subject: message.subject,
      html: message.html,
      text: message.text,
    })

    if (error) {
      logger.error('Email send rejected by Resend', {
        action: 'email.failed',
        metadata: {
          recipients: recipients.length,
          subject: message.subject,
          error: error.message,
          name: error.name,
        },
      })
      return { sent: 0, failed: recipients.length, skipped: false }
    }

    logger.info('Email sent', {
      action: 'email.sent',
      metadata: { recipients: recipients.length, subject: message.subject, id: data?.id ?? null },
    })
    return { sent: recipients.length, failed: 0, skipped: false }
  } catch (err) {
    logger.error('Email send threw', {
      action: 'email.failed',
      errorMessage: String(err),
      metadata: { recipients: recipients.length, subject: message.subject },
    })
    return { sent: 0, failed: recipients.length, skipped: false }
  }
}
