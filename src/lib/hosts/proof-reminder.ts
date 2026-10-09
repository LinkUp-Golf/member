// When a host is reminded to upload proof of their round.
//
// Twenty minutes after the round's tee time, in the venue's own timezone: the
// group has gone off, and the host is still at the club with the phone that
// took the photo. Pure so the cron and the tests read the same instant.

import { bookingToLocalDate } from '@/lib/utils'
import { isTeeTime, normaliseTeeTime } from '@/lib/hosts/tee-time'

export const PROOF_REMINDER_DELAY_MINUTES = 20

/** Statuses a round can be reminded in — it's running, or has run, without proof. */
export const PROOF_REMINDABLE_STATUSES = ['upcoming', 'completed'] as const

/**
 * The instant the reminder becomes due, or null for a round with no clock tee
 * time (a legacy free-text row) — there's no "20 minutes after" to anchor to.
 */
export function proofReminderDueAt(
  eventDate: string,
  teeTime: string | null,
  timezone?: string | null,
): Date | null {
  if (!isTeeTime(teeTime)) return null
  const start = timezone
    ? bookingToLocalDate(eventDate.slice(0, 10), `${normaliseTeeTime(teeTime)}:00`, timezone)
    : bookingToLocalDate(eventDate.slice(0, 10), `${normaliseTeeTime(teeTime)}:00`)
  return new Date(start.getTime() + PROOF_REMINDER_DELAY_MINUTES * 60_000)
}

export function isProofReminderDue(
  event: { event_date: string; tee_time: string | null },
  timezone: string | null | undefined,
  now: Date,
): boolean {
  const due = proofReminderDueAt(event.event_date, event.tee_time, timezone)
  return due !== null && now.getTime() >= due.getTime()
}
