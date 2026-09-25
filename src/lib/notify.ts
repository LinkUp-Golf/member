// Telling a member something, on every channel that suits it.
//
// One notification, described once (NotificationTemplates in ./push), delivered
// as a push and as an email. The two are not interchangeable and that's the
// point: a push is a tap away but only reaches an installed app with permission
// granted, and it's gone once dismissed. An email arrives whether or not the
// app was ever installed, and it's still there tomorrow.
//
// ---- Which notifications belong here ----
//
// All of them. Every template in NotificationTemplates has an email
// counterpart, so this is the default way to send one and `sendPushTo*` is
// only for the rare case that genuinely shouldn't leave the device.
//
// Nothing is rationed: no cooldown, no daily cap, no send log. A member who is
// sent twenty notifications receives twenty emails, which is the behaviour
// that was asked for. If that ever needs limiting, the limit belongs here,
// where both channels already meet, rather than at any one call site.
//
// ---- Failure ----
//
// Neither channel can fail the caller. These return counts and never throw, and
// every call site void-s them: a notification is a side effect of an action
// that has already happened, and a mail outage must not roll back a booking.

import {
  sendPushToMember,
  sendPushToMembers,
  sendPushToAdmins,
  courseMemberIds,
  focusMemberIds,
} from '@/lib/push'
import {
  sendEmailToMember,
  sendEmailToMembers,
  sendEmailToAdmins,
} from '@/lib/email/send'
import { logger } from '@/lib/logger'
import type { PushPayload } from '@/lib/push/types'

export interface NotifyResult {
  push: { sent: number; failed: number }
  email: { sent: number; failed: number; skipped: boolean }
}

/**
 * Keeps a notification alive past the response that triggered it.
 *
 * Every call site fires a notification without awaiting it, so a booking or an
 * invite isn't held up by a mail server. On a long-lived server that's free.
 * On Vercel it isn't: the function can be frozen the moment the response is
 * sent, and anything still in flight — the push, the email, and the log lines
 * that would have said so — dies with it. Silent, intermittent, and looks
 * exactly like a broken email channel. No error, no logs, no mail.
 *
 * Vercel exposes a request context carrying waitUntil, which is the supported
 * way to say "this request isn't finished yet". It's read through the global
 * symbol rather than by adding @vercel/functions, so this stays dependency-free
 * and is simply a no-op anywhere else.
 *
 * The same promise is registered and returned, so a caller that does await the
 * result — the surveys cron counts them — still gets it.
 */
type VercelRequestContext = { waitUntil?: (p: Promise<unknown>) => void }

export function kept<T>(work: Promise<T>): Promise<T> {
  try {
    const store = (
      globalThis as {
        [k: symbol]: { get?: () => VercelRequestContext | undefined } | undefined
      }
    )[Symbol.for('@vercel/request-context')]

    const waitUntil = store?.get?.()?.waitUntil
    // The promise never rejects — both() catches everything — but waitUntil
    // treats a rejection as a failed invocation, so guard it anyway.
    if (typeof waitUntil === 'function') waitUntil(work.catch(() => undefined))
  } catch {
    // A missing or changed internal is not worth failing a notification over.
  }
  return work
}

const NONE: NotifyResult = {
  push: { sent: 0, failed: 0 },
  email: { sent: 0, failed: 0, skipped: false },
}

/**
 * Runs both channels, and lets neither take the other down.
 *
 * allSettled rather than all: a web-push failure and a Resend outage are
 * independent, and a member who can be reached one way should be.
 */
async function both(
  action: string,
  title: string,
  audience: Record<string, unknown>,
  push: () => Promise<{ sent: number; failed: number }>,
  email: () => Promise<{ sent: number; failed: number; skipped: boolean }>,
): Promise<NotifyResult> {
  const startedAt = Date.now()
  const [pushed, mailed] = await Promise.allSettled([push(), email()])

  const result: NotifyResult = {
    push: pushed.status === 'fulfilled' ? pushed.value : { sent: 0, failed: 0 },
    email:
      mailed.status === 'fulfilled'
        ? mailed.value
        : { sent: 0, failed: 0, skipped: false },
  }

  if (pushed.status === 'rejected') {
    logger.error('Push channel failed', {
      action: `${action}.push_failed`,
      errorMessage: pushed.reason instanceof Error ? pushed.reason.message : String(pushed.reason),
      metadata: { title },
    })
  }
  if (mailed.status === 'rejected') {
    logger.error('Email channel failed', {
      action: `${action}.email_failed`,
      errorMessage: mailed.reason instanceof Error ? mailed.reason.message : String(mailed.reason),
      metadata: { title },
    })
  }

  // One line per notification, carrying both channels. Grep 'notify.' in the
  // logs and you get the whole delivery history: what was sent, to how many,
  // and which channel did or didn't do its half.
  logger.info('Notification dispatched', {
    action,
    durationMs: Date.now() - startedAt,
    metadata: {
      title,
      ...audience,
      pushSent: result.push.sent,
      pushFailed: result.push.failed,
      emailSent: result.email.sent,
      emailFailed: result.email.failed,
      emailSkipped: result.email.skipped,
    },
  })

  return result
}

/** One member, both ways. */
export async function notifyMember(
  memberId: string,
  payload: PushPayload,
): Promise<NotifyResult> {
  if (!memberId) {
    logger.warn('Notification dropped: no member id', {
      action: 'notify.member.no_recipient',
      metadata: { title: payload.title },
    })
    return NONE
  }
  return kept(both(
    'notify.member',
    payload.title,
    { memberId },
    () => sendPushToMember(memberId, payload),
    () => sendEmailToMember(memberId, payload),
  ))
}

/** Several members, both ways. Emails are bcc'd, so nobody sees the list. */
export async function notifyMembers(
  memberIds: string[],
  payload: PushPayload,
): Promise<NotifyResult> {
  const ids = Array.from(new Set(memberIds.filter(Boolean)))
  if (ids.length === 0) {
    logger.warn('Notification dropped: no member ids', {
      action: 'notify.members.no_recipients',
      metadata: { title: payload.title },
    })
    return NONE
  }
  return kept(both(
    'notify.members',
    payload.title,
    { members: ids.length },
    () => sendPushToMembers(ids, payload),
    () => sendEmailToMembers(ids, payload),
  ))
}

/**
 * Every active member of a course, both ways.
 *
 * The audience is resolved once and given to both channels, so a broadcast
 * can't mean one thing on a phone and another in an inbox. Note the size of
 * that audience: this emails every active member of the course, with nothing
 * throttling it.
 */
export async function notifyCourse(
  courseId: string,
  payload: PushPayload,
  excludeUserId?: string,
): Promise<NotifyResult> {
  const ids = await courseMemberIds(courseId, excludeUserId)
  if (ids.length === 0) return NONE
  return kept(both(
    'notify.course',
    payload.title,
    { courseId, members: ids.length },
    () => sendPushToMembers(ids, payload),
    () => sendEmailToMembers(ids, payload),
  ))
}

/** Course members subscribed to any of these focus categories, both ways. */
export async function notifyFocusMembers(
  courseId: string,
  focusCategories: string[],
  payload: PushPayload,
  excludeUserId?: string,
): Promise<NotifyResult> {
  const ids = await focusMemberIds(courseId, focusCategories, excludeUserId)
  if (ids.length === 0) return NONE
  return kept(both(
    'notify.focus',
    payload.title,
    { courseId, members: ids.length, categories: focusCategories.length },
    () => sendPushToMembers(ids, payload),
    () => sendEmailToMembers(ids, payload),
  ))
}

/** Every admin, both ways — the queue notifications nobody should sit on. */
export async function notifyAdmins(payload: PushPayload): Promise<NotifyResult> {
  return kept(both(
    'notify.admins',
    payload.title,
    { audience: 'admins' },
    () => sendPushToAdmins(payload),
    () => sendEmailToAdmins(payload),
  ))
}
