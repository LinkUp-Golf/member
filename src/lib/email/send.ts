// Turning a notification into an email to particular members.
//
// The payload is the same object the push service takes (src/lib/push.ts), so a
// notification is written once and reaches a member twice. What this adds is
// the part push doesn't need: the member's address, an absolute URL for the
// button (push hands the service worker a relative path; an email client has no
// app to resolve one against), and the wording on the button.

import { createAdminClient } from '@/lib/supabase-server'
import { logger } from '@/lib/logger'
import { renderNotificationEmail } from './template'
import { sendEmail, type EmailSendResult } from './client'
import type { PushPayload } from '@/lib/push/types'

/** Resend takes at most 50 addresses per call. */
const BATCH_SIZE = 50

/** What the button says when a notification doesn't name its own action. */
const DEFAULT_CTA = 'Open in LinkUp'

const appUrl = (): string =>
  (process.env.NEXT_PUBLIC_APP_URL || 'https://app.linkup.golf').replace(/\/+$/, '')

/**
 * The absolute address of a notification's destination.
 *
 * Push stores a relative path ('/book', '/members/123') because the service
 * worker resolves it against the app's own origin. An email has no origin to
 * resolve against, so the app URL is prefixed here. An absolute URL that's
 * already been supplied is passed through.
 */
export function absoluteUrl(path: string | undefined): string {
  const target = path?.trim() || '/'
  if (/^https?:\/\//i.test(target)) return target
  return `${appUrl()}${target.startsWith('/') ? target : `/${target}`}`
}

/** The email for one notification, rendered but not yet addressed. */
export function renderNotification(payload: PushPayload) {
  return renderNotificationEmail({
    heading: payload.title,
    body: payload.body,
    ctaUrl: absoluteUrl(payload.url),
    ctaLabel: payload.cta || DEFAULT_CTA,
    logoUrl: `${appUrl()}/logos/logo-full-color.png`,
    // The push notification's own image, when it has one — same asset, same
    // notification. Relative paths are resolved like the destination is.
    imageUrl: payload.image ? absoluteUrl(payload.image) : null,
    preheader: payload.body,
    settingsUrl: `${appUrl()}/more/settings`,
  })
}

const empty = (): EmailSendResult => ({ sent: 0, failed: 0, skipped: false })

/** Sends one notification to a set of addresses, batched to Resend's limit. */
export async function sendNotificationEmail(
  addresses: string[],
  payload: PushPayload,
): Promise<EmailSendResult> {
  const recipients = Array.from(
    new Set(addresses.map(a => a?.trim().toLowerCase()).filter((a): a is string => !!a)),
  )
  if (recipients.length === 0) {
    // The quietest way this channel fails: the notification is built, the key
    // is valid, and there is simply nobody to send it to. It used to return
    // here without a word, which looks identical to email being switched off.
    logger.warn('Notification email has no recipients', {
      action: 'email.no_recipients',
      metadata: { title: payload.title },
    })
    return empty()
  }

  const { subject, html, text } = renderNotification(payload)

  logger.info('Notification email prepared', {
    action: 'email.prepared',
    metadata: {
      subject,
      recipients: recipients.length,
      // The destination the button opens. A relative push path that didn't get
      // an origin, or an app URL with a stray inline comment in .env, shows up
      // here as something that obviously isn't a link.
      ctaUrl: absoluteUrl(payload.url),
      batches: Math.ceil(recipients.length / BATCH_SIZE),
    },
  })

  const totals = empty()
  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const batch = recipients.slice(i, i + BATCH_SIZE)
    const result = await sendEmail({ to: batch, subject, html, text })
    totals.sent += result.sent
    totals.failed += result.failed
    totals.skipped = totals.skipped || result.skipped
  }
  return totals
}

/**
 * Membership states that have lost access to the app.
 *
 * The button opens a page behind the login gate, so mailing one of these is an
 * invitation to a locked door. 'cancelled' is where the nightly GHL reconcile
 * puts a member whose access tag was removed; 'suspended' is a moderation
 * outcome. Everything else — including 'waitlist' and 'non_member', who are
 * real people with real reasons to hear from us — still gets the email.
 */
const NO_ACCESS_STATUSES: readonly string[] = ['cancelled', 'suspended']

/** The addresses of the given members, skipping anyone who can't get in. */
export async function memberEmails(memberIds: string[]): Promise<string[]> {
  const ids = Array.from(new Set(memberIds.filter(Boolean)))
  if (ids.length === 0) return []

  const { data, error } = await createAdminClient()
    .from('members')
    .select('email, membership_status')
    .in('id', ids)

  if (error) {
    // Almost always the service-role key: createAdminClient() bypasses RLS, so
    // a key that doesn't authenticate fails here and nowhere the member can
    // see. The message goes in errorMessage so it actually prints.
    logger.error('Could not resolve member emails', {
      action: 'email.recipients_failed',
      errorCode: error.code,
      errorMessage: error.message,
      metadata: { asked: ids.length, hint: error.hint ?? null },
    })
    return []
  }

  const rows = data ?? []
  const blocked = rows.filter(m =>
    NO_ACCESS_STATUSES.includes((m.membership_status as string | null) ?? ''),
  )
  const addresses = rows
    .filter(m => !NO_ACCESS_STATUSES.includes((m.membership_status as string | null) ?? ''))
    .map(m => (m.email as string | null) ?? '')
    .filter(Boolean)

  // Every way a recipient can vanish between an id and an inbox, counted: the
  // row wasn't found, the member has lost access, or the row has no address.
  // Without this, an email that never arrives and an email that was never
  // addressed are the same silence.
  if (addresses.length < ids.length) {
    logger.warn('Some members will not be emailed', {
      action: 'email.recipients_dropped',
      metadata: {
        asked: ids.length,
        found: rows.length,
        missingRows: ids.length - rows.length,
        blockedByStatus: blocked.length,
        blockedStatuses: Array.from(
          new Set(blocked.map(m => (m.membership_status as string | null) ?? 'null')),
        ),
        noAddress: rows.length - blocked.length - addresses.length,
        resolved: addresses.length,
      },
    })
  }

  return addresses
}

/** One member, by id. */
export async function sendEmailToMember(
  memberId: string,
  payload: PushPayload,
): Promise<EmailSendResult> {
  return sendNotificationEmail(await memberEmails([memberId]), payload)
}

/** Several members, by id. */
export async function sendEmailToMembers(
  memberIds: string[],
  payload: PushPayload,
): Promise<EmailSendResult> {
  return sendNotificationEmail(await memberEmails(memberIds), payload)
}

/** Everyone with is_admin — the same audience sendPushToAdmins reaches. */
export async function sendEmailToAdmins(payload: PushPayload): Promise<EmailSendResult> {
  const { data, error } = await createAdminClient()
    .from('members')
    .select('email')
    .eq('is_admin', true)

  if (error) {
    logger.error('Could not resolve admin emails', {
      action: 'email.recipients_failed',
      errorCode: error.code,
      errorMessage: error.message,
      metadata: { audience: 'admins' },
    })
    return empty()
  }

  return sendNotificationEmail(
    (data ?? []).map(m => (m.email as string | null) ?? '').filter(Boolean),
    payload,
  )
}
