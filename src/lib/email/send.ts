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
import { recordEmailsSent } from './log'
import { categoryFor, notificationKey } from './policy'
import type { PushPayload } from '@/lib/push/types'

/** Resend takes at most 50 addresses per call. */
const BATCH_SIZE = 50

/** What the button says when a notification doesn't name its own action. */
const DEFAULT_CTA = 'Open in LinkUp'

const PRODUCTION_APP_URL = 'https://app.linkup.golf'

const appUrl = (): string =>
  (process.env.NEXT_PUBLIC_APP_URL || PRODUCTION_APP_URL).replace(/\/+$/, '')

/**
 * Where an image in an email is fetched from.
 *
 * Not the same as appUrl(), and the difference only shows up in development. A
 * link can point at localhost — you click it on the machine that serves it. An
 * image is fetched by the recipient's mail client, which is Gmail's proxy or a
 * phone, and neither can reach your laptop: every test email sent from a dev
 * machine arrives with a broken logo. So assets resolve against production even
 * when the app doesn't. The asset is public and immutable, so serving the live
 * copy to a local test is correct rather than a workaround.
 */
export function assetUrl(path: string): string {
  const base = /localhost|127\.0\.0\.1|\[::1\]/i.test(appUrl())
    ? PRODUCTION_APP_URL
    : appUrl()
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}

/** The mark at the top of every email — public/logos/logo-full-color.png. */
export const LOGO_PATH = '/logos/logo-full-color.png'

/**
 * Every asset an email points at, so a test can check each is in public/.
 *
 * An email image is fetched from the live site by the recipient's mail client,
 * which means a path that is merely correct isn't enough — the file has to
 * have shipped. A broken image is invisible until someone opens a real email,
 * and by then it has been sent.
 */
export const EMAIL_ASSET_PATHS = [LOGO_PATH] as const

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
    // The notification's own subject when it has one. A push title is read
    // beside the app's name; a subject line stands alone in an inbox.
    subject: payload.subject,
    body: payload.body,
    ctaUrl: absoluteUrl(payload.url),
    ctaLabel: payload.cta || DEFAULT_CTA,
    logoUrl: assetUrl(LOGO_PATH),
    // The push notification's own image, when it has one — same asset, same
    // notification. A relative path is one of ours, so it resolves against the
    // asset origin; an absolute one is already wherever it lives.
    imageUrl: payload.image
      ? /^https?:\/\//i.test(payload.image)
        ? payload.image
        : assetUrl(payload.image)
      : null,
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

export interface Recipient {
  memberId: string
  email: string
}

/**
 * The addresses of the given members, skipping anyone who can't get in.
 *
 * Returns the member id alongside each address because a send is logged per
 * member, and only the members who were actually mailed should appear in it.
 */
export async function resolveRecipients(memberIds: string[]): Promise<Recipient[]> {
  const ids = Array.from(new Set(memberIds.filter(Boolean)))
  if (ids.length === 0) return []

  const { data, error } = await createAdminClient()
    .from('members')
    .select('id, email')
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
  const recipients: Recipient[] = rows
    .map(m => ({ memberId: m.id as string, email: (m.email as string | null) ?? '' }))
    .filter(r => !!r.email)

  // Membership status is deliberately not consulted. A member who has been
  // suspended or whose membership lapsed is still a person we have things to
  // tell — and the one notification that would bring them back is exactly the
  // one a status filter would withhold.
  //
  // members.email is NOT NULL, so the only way someone disappears here is that
  // their row wasn't found at all: a stale id, or a member deleted between the
  // action and the notification. Rare, and worth a line when it happens.
  if (recipients.length < ids.length) {
    logger.warn('Some members could not be emailed', {
      action: 'email.recipients_dropped',
      metadata: {
        asked: ids.length,
        found: rows.length,
        missingRows: ids.length - rows.length,
        noAddress: rows.length - recipients.length,
        resolved: recipients.length,
      },
    })
  }

  return recipients
}

/** The addresses alone, for callers that have no member ids to throttle on. */
export async function memberEmails(memberIds: string[]): Promise<string[]> {
  return (await resolveRecipients(memberIds)).map(r => r.email)
}

/**
 * Emails a notification to members.
 *
 * The one door every member-addressed email goes through. Nothing is
 * suppressed on volume — if a notification was worth sending, every recipient
 * gets it — so the only reason someone here doesn't receive one is that they
 * have no usable address. What the provider accepted is recorded, so the
 * history exists whether or not anything ever reads it.
 */
async function sendToMemberIds(
  memberIds: string[],
  payload: PushPayload,
): Promise<EmailSendResult> {
  const ids = Array.from(new Set(memberIds.filter(Boolean)))
  if (ids.length === 0) return empty()

  const recipients = await resolveRecipients(ids)
  if (recipients.length === 0) return empty()

  const result = await sendNotificationEmail(recipients.map(r => r.email), payload)

  if (result.sent > 0) {
    await recordEmailsSent(
      recipients.map(r => r.memberId),
      notificationKey(payload.tag),
      categoryFor(payload.tag),
    )
  }

  return result
}

/** One member, by id. */
export async function sendEmailToMember(
  memberId: string,
  payload: PushPayload,
): Promise<EmailSendResult> {
  return sendToMemberIds([memberId], payload)
}

/** Several members, by id. */
export async function sendEmailToMembers(
  memberIds: string[],
  payload: PushPayload,
): Promise<EmailSendResult> {
  return sendToMemberIds(memberIds, payload)
}

/** Everyone with is_admin — the same audience sendPushToAdmins reaches. */
export async function sendEmailToAdmins(payload: PushPayload): Promise<EmailSendResult> {
  const { data, error } = await createAdminClient()
    .from('members')
    .select('id')
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

  return sendToMemberIds((data ?? []).map(m => m.id as string), payload)
}
