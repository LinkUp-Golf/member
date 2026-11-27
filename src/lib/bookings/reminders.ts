// When a round's reminders go out, and what they say. Pure, so it's tested.
//
// Three reminders, for booked tee times and hosted rounds alike: 7 days and
// 3 days before the tee time, and 8 PM the night before (venue time). Each one
// is a push and an email from the app (notifyMember). They used to be a push
// from the app plus an email and text from a GHL workflow; the client dropped
// the text and asked for one wording everywhere (2026-11-27).
//
// "Night before" replaced a reminder 6 hours before the tee time, which for a
// morning round arrived in the small hours, and the client judged it enough on
// its own, without one on the morning of the round (2026-11-27). Its flag is
// reminder_evening_sent; bookings.reminder_6h_sent is no longer read.

import { fromZonedTime } from 'date-fns-tz'

export type ReminderKind = '7d' | '3d' | 'evening'

/** The column on bookings / hosted_event_registrations that marks it sent. */
export const REMINDER_FLAGS: Record<ReminderKind, string> = {
  '7d': 'reminder_7d_sent',
  '3d': 'reminder_3d_sent',
  evening: 'reminder_evening_sent',
}

export const REMINDER_KINDS: ReminderKind[] = ['7d', '3d', 'evening']

const MINUTE = 60 * 1000
const DAY = 24 * 60 * MINUTE

/** The night-before reminder's clock time at the venue, the day before the round. */
export const EVENING_REMINDER_TIME = '20:00:00'

/**
 * How early and how late a cron run may send a reminder. The cron runs every
 * 15 minutes; a reminder is sent by the first run from 8 minutes before its
 * moment, and up to 30 minutes after it, so one missed run doesn't lose it.
 * Not later than that: a round booked two days out must not receive its
 * "7 days" reminder the moment the cron first sees it.
 */
export const SEND_EARLY_MS = 8 * MINUTE
export const SEND_LATE_MS = 30 * MINUTE

/** The UTC instant of a wall-clock time at the venue. */
export function venueInstant(date: string, time: string, timezone: string): Date {
  return fromZonedTime(`${date.slice(0, 10)}T${time}`, timezone)
}

/** The calendar day before 'YYYY-MM-DD', as 'YYYY-MM-DD'. */
function dayBefore(date: string): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/** When each reminder is due for a round at this venue-local date and tee time. */
export function reminderTimes(
  date: string,
  teeTime: string,
  timezone: string,
): Record<ReminderKind, Date> {
  const tee = venueInstant(date, teeTime, timezone).getTime()
  return {
    '7d': new Date(tee - 7 * DAY),
    '3d': new Date(tee - 3 * DAY),
    evening: venueInstant(dayBefore(date), EVENING_REMINDER_TIME, timezone),
  }
}

/** Reminders due on this cron run that haven't been sent. */
export function dueReminders(
  date: string,
  teeTime: string,
  timezone: string,
  sent: Partial<Record<ReminderKind, boolean>>,
  now: Date,
): ReminderKind[] {
  const times = reminderTimes(date, teeTime, timezone)
  const t = now.getTime()
  return REMINDER_KINDS.filter((kind) => {
    if (sent[kind]) return false
    const at = times[kind].getTime()
    return t >= at - SEND_EARLY_MS && t <= at + SEND_LATE_MS
  })
}

/** The client's wording (2026-11-27), the same for every reminder. */
export function reminderBody(venue: string, date: string, time: string): string {
  return `You're playing golf at ${venue} on ${date} and your tee time is ${time}. Please arrive 30 minutes early for warm up and introductions. Hit 'em straight!`
}

export function reminderTitle(kind: ReminderKind): string {
  switch (kind) {
    case '7d': return 'Your round is a week away'
    case '3d': return 'Your round is in 3 days'
    case 'evening': return 'You play tomorrow'
  }
}

export function reminderSubject(kind: ReminderKind, venue: string, date: string, time: string): string {
  return kind === 'evening'
    ? `Tomorrow at ${venue}: your tee time is ${time}`
    : `Reminder: ${venue} on ${date} at ${time}`
}
