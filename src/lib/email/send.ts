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
import {
  BATCH_LIMIT,
  maskEmail,
  sendEmailBatch,
  type EmailMessage,
  type EmailSendResult,
} from './client'
import { filterSuppressed } from './suppression'
import { UNSUBSCRIBE_PATH, unsubscribeToken } from './unsubscribe'
import type { PushPayload } from '@/lib/push/types'

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

/**
 * This recipient's own way out, as an absolute link.
 *
 * Per address, because that's what an unsubscribe is about: the mailbox, not
 * the member row behind it. Returns '' when the token can't be signed, and the
 * footer and the headers both drop it rather than offering a link that
 * wouldn't work.
 */
export function unsubscribeUrl(address: string): string {
  const token = unsubscribeToken(address)
  return token ? `${appUrl()}${UNSUBSCRIBE_PATH}?t=${encodeURIComponent(token)}` : ''
}

/**
 * The headers that make a mail client's own unsubscribe button work.
 *
 * RFC 8058: the URL must accept a POST with no body and act on it without
 * asking anything further, which is what List-Unsubscribe-Post promises and
 * what /api/email/unsubscribe does. Gmail and Yahoo have required this of bulk
 * senders since February 2024; without it their readers have no button, and
 * the button they do have is "report spam".
 */
export function listUnsubscribeHeaders(url: string): Record<string, string> {
  if (!url) return {}
  return {
    'List-Unsubscribe': `<${url}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
}

/**
 * The email for one notification, rendered for one recipient.
 *
 * Addressed rather than generic: the unsubscribe link is the recipient's own,
 * so the same notification renders once per person. Called without an address
 * — the admin smoke test — it renders with no unsubscribe link at all.
 */
export function renderNotification(payload: PushPayload, recipient?: string) {
  return renderNotificationEmail({
    unsubscribeUrl: recipient ? unsubscribeUrl(recipient) : '',
    heading: payload.title,
    // The notification's own subject when it has one. A push title is read
    // beside the app's name; a subject line stands alone in an inbox.
    subject: payload.subject,
    body: payload.body,
    ctaUrl: absoluteUrl(payload.url),
    ctaLabel: payload.cta || DEFAULT_CTA,
    logoUrl: assetUrl(LOGO_PATH),
    // The notification's own images, when it has any — same assets, same
    // notification. `images` is the whole set (an announcement's photos) and
    // `image` the single one push can show, so either answers this. A relative
    // path is one of ours and resolves against the asset origin; an absolute one
    // is already wherever it lives.
    imageUrls: (payload.images?.length
      ? payload.images
      : payload.image
        ? [payload.image]
        : []
    ).map(src => (/^https?:\/\//i.test(src) ? src : assetUrl(src))),
    preheader: payload.body,
    settingsUrl: `${appUrl()}/more/settings`,
  })
}

const empty = (): EmailSendResult => ({ sent: 0, failed: 0, skipped: false })

/**
 * Sends one notification to a set of addresses.
 *
 * Two things happen here that didn't used to. Anyone on the suppression list
 * is dropped before a message is built — a hard bounce, a spam complaint or an
 * unsubscribe, and continuing to mail any of the three is what ruins a sending
 * domain for everybody else. And what's left is sent one message per person
 * rather than one bcc'd message per fifty, because only an individually
 * addressed message can carry that person's own unsubscribe header.
 */
export async function sendNotificationEmail(
  addresses: string[],
  payload: PushPayload,
): Promise<EmailSendResult> {
  const { allowed, suppressed } = await filterSuppressed(addresses)

  if (suppressed.length > 0) {
    logger.info('Notification email withheld from suppressed addresses', {
      action: 'email.suppressed_recipients',
      metadata: {
        title: payload.title,
        withheld: suppressed.length,
        to: suppressed.slice(0, 5).map(maskEmail),
      },
    })
  }

  if (allowed.length === 0) {
    // The quietest way this channel fails: the notification is built, the key
    // is valid, and there is simply nobody to send it to. It used to return
    // here without a word, which looks identical to email being switched off.
    logger.warn('Notification email has no recipients', {
      action: 'email.no_recipients',
      metadata: { title: payload.title, withheld: suppressed.length },
    })
    return empty()
  }

  // The body is the same for everyone; only the footer's unsubscribe link and
  // the headers differ, so the render runs per recipient and the subject is
  // read off the first.
  const messages: EmailMessage[] = allowed.map(to => {
    const opt = unsubscribeUrl(to)
    const { subject, html, text } = renderNotification(payload, to)
    return { to: [to], subject, html, text, headers: listUnsubscribeHeaders(opt) }
  })

  logger.info('Notification email prepared', {
    action: 'email.prepared',
    metadata: {
      subject: messages[0]?.subject,
      recipients: messages.length,
      // The destination the button opens. A relative push path that didn't get
      // an origin, or an app URL with a stray inline comment in .env, shows up
      // here as something that obviously isn't a link.
      ctaUrl: absoluteUrl(payload.url),
      batches: Math.ceil(messages.length / BATCH_LIMIT),
      oneClickUnsubscribe: !!messages[0]?.headers?.['List-Unsubscribe'],
    },
  })

  const totals = empty()
  for (let i = 0; i < messages.length; i += BATCH_LIMIT) {
    const result = await sendEmailBatch(messages.slice(i, i + BATCH_LIMIT))
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
 * Returns the member id alongside each address so a caller can tell which of
 * the ids it asked for resolved to someone reachable.
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
 * suppressed — if a notification was worth sending, every recipient gets it —
 * so the only reason someone here doesn't receive one is that they have no
 * usable address.
 */
async function sendToMemberIds(
  memberIds: string[],
  payload: PushPayload,
): Promise<EmailSendResult> {
  const ids = Array.from(new Set(memberIds.filter(Boolean)))
  if (ids.length === 0) return empty()

  const recipients = await resolveRecipients(ids)
  if (recipients.length === 0) return empty()

  return sendNotificationEmail(recipients.map(r => r.email), payload)
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
