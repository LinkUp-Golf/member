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
// Not all of them. `sendPushToMember` and friends stay exactly as they were and
// remain the right call for anything chatty — a new message, someone booking a
// tee time, a play suggestion. Emailing those would turn a busy Saturday into
// twenty emails and teach members to filter us.
//
// `notifyMember` is for the ones a member would be annoyed to have missed: a
// booking that needs paying, an application approved or turned down, credit
// issued, a round taken down, a venue going live. If you're unsure, ask whether
// it would still matter tomorrow. If not, it's a push.
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
  push: () => Promise<{ sent: number; failed: number }>,
  email: () => Promise<{ sent: number; failed: number; skipped: boolean }>,
): Promise<NotifyResult> {
  const [pushed, mailed] = await Promise.allSettled([push(), email()])

  const result: NotifyResult = {
    push: pushed.status === 'fulfilled' ? pushed.value : { sent: 0, failed: 0 },
    email:
      mailed.status === 'fulfilled'
        ? mailed.value
        : { sent: 0, failed: 0, skipped: false },
  }

  if (pushed.status === 'rejected') {
    logger.warn('Push channel failed', { action: `${action}.push_failed`, errorMessage: String(pushed.reason) })
  }
  if (mailed.status === 'rejected') {
    logger.warn('Email channel failed', { action: `${action}.email_failed`, errorMessage: String(mailed.reason) })
  }

  return result
}

/** One member, both ways. */
export async function notifyMember(
  memberId: string,
  payload: PushPayload,
): Promise<NotifyResult> {
  if (!memberId) return NONE
  return both(
    'notify.member',
    () => sendPushToMember(memberId, payload),
    () => sendEmailToMember(memberId, payload),
  )
}

/** Several members, both ways. Emails are bcc'd, so nobody sees the list. */
export async function notifyMembers(
  memberIds: string[],
  payload: PushPayload,
): Promise<NotifyResult> {
  const ids = Array.from(new Set(memberIds.filter(Boolean)))
  if (ids.length === 0) return NONE
  return both(
    'notify.members',
    () => sendPushToMembers(ids, payload),
    () => sendEmailToMembers(ids, payload),
  )
}

/** Every admin, both ways — the queue notifications nobody should sit on. */
export async function notifyAdmins(payload: PushPayload): Promise<NotifyResult> {
  return both(
    'notify.admins',
    () => sendPushToAdmins(payload),
    () => sendEmailToAdmins(payload),
  )
}
