// ============================================================
// When a booking's satisfaction survey becomes askable.
//
// The prompt is anchored to the round itself, not to when the member next
// opens the app: tee time + how long a round takes at that course + a short
// grace period. A 1:35pm tee at a course with a 180-minute round is asked at
// 4:40pm — while the member is still likely to be at the club.
//
// Everything here is pure so the API (which decides what to send) and the
// client (which sets the timer) agree on the same instant.
// ============================================================

import { bookingToLocalDate } from '@/lib/utils'

/** Grace period after the round is scheduled to end, before asking. */
export const SURVEY_DELAY_MINUTES = 5

/** Fallback round length when a course row doesn't carry one (schema default). */
export const DEFAULT_ROUND_MINUTES = 300

/**
 * How far ahead the pending-survey endpoint looks. The client sets a live timer
 * for anything inside this window, so it covers a member who opens the app
 * before their round and leaves the tab open through the end of it.
 */
export const SURVEY_LOOKAHEAD_HOURS = 14

/**
 * Only bookings that actually got as far as being paid/confirmed are worth
 * asking about. A tentative or awaiting-approval booking never became a round,
 * and availability_confirmed means the member was offered a slot but never
 * paid for it.
 */
export const SURVEYABLE_BOOKING_STATUSES = ['confirmed', 'payment_confirmed'] as const

export interface SurveyableBooking {
  booking_date: string
  tee_time: string
}

export interface SurveyableCourse {
  timezone?: string | null
  meeting_duration_mins?: number | null
}

/**
 * The instant a booking's survey becomes askable.
 *
 * booking_date + tee_time are stored in the course's own local time, so they
 * are resolved against `course.timezone` — using the server's or the browser's
 * zone would shift the prompt by hours for any course outside it.
 */
export function surveyDueAt(
  booking: SurveyableBooking,
  course?: SurveyableCourse | null,
): Date {
  const tz = course?.timezone ?? undefined
  const start = tz
    ? bookingToLocalDate(booking.booking_date, booking.tee_time, tz)
    : bookingToLocalDate(booking.booking_date, booking.tee_time)

  const duration = course?.meeting_duration_mins ?? DEFAULT_ROUND_MINUTES
  const minutes = duration + SURVEY_DELAY_MINUTES
  return new Date(start.getTime() + minutes * 60_000)
}

/**
 * Who gets asked about a round: whoever actually played it.
 *
 * A booking can be made by one member on another's behalf (`player_member_id`),
 * in which case the player — not the booker — is the one with an opinion about
 * the round. This matches who the booking-reminders cron notifies, so the same
 * person who was reminded about the tee time is the one asked about it after.
 */
export function surveyRecipientId(booking: {
  member_id: string
  player_member_id?: string | null
}): string {
  return booking.player_member_id ?? booking.member_id
}

/**
 * PostgREST `.or()` filter selecting the bookings a given member should be
 * asked about — theirs to play, whether they booked it or were added to it.
 */
export function surveyRecipientFilter(memberId: string): string {
  return `and(player_member_id.is.null,member_id.eq.${memberId}),player_member_id.eq.${memberId}`
}

/** True once the round has finished and the grace period has elapsed. */
export function isSurveyDue(
  booking: SurveyableBooking,
  course?: SurveyableCourse | null,
  now: Date = new Date(),
): boolean {
  return surveyDueAt(booking, course).getTime() <= now.getTime()
}
