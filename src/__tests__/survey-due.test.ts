import { describe, it, expect } from 'vitest'
import {
  surveyDueAt,
  isSurveyDue,
  surveyRecipientId,
  surveyRecipientFilter,
  SURVEY_DELAY_MINUTES,
  DEFAULT_ROUND_MINUTES,
  SURVEYABLE_BOOKING_STATUSES,
} from '@/lib/surveys/due'

// A booking's survey is asked at tee time + the course's round length + a
// short grace period, resolved in the course's own timezone.

const PACIFIC = 'America/Los_Angeles'
const EASTERN = 'America/New_York'

describe('surveyDueAt', () => {
  it('adds the round length and the grace period to the tee time', () => {
    // 1:35pm Pacific + 180 min round + 5 min = 4:40pm Pacific = 23:40 UTC.
    const due = surveyDueAt(
      { booking_date: '2026-07-15', tee_time: '13:35:00' },
      { timezone: PACIFIC, meeting_duration_mins: 180 },
    )
    expect(due.toISOString()).toBe('2026-07-15T23:40:00.000Z')
  })

  it('resolves the tee time in the course timezone, not the runtime one', () => {
    const pacific = surveyDueAt(
      { booking_date: '2026-07-15', tee_time: '08:00:00' },
      { timezone: PACIFIC, meeting_duration_mins: 60 },
    )
    const eastern = surveyDueAt(
      { booking_date: '2026-07-15', tee_time: '08:00:00' },
      { timezone: EASTERN, meeting_duration_mins: 60 },
    )
    // Same wall-clock tee time, three hours apart in real time.
    expect(pacific.getTime() - eastern.getTime()).toBe(3 * 60 * 60 * 1000)
  })

  it('falls back to the default round length when the course has none', () => {
    const withNulls = surveyDueAt(
      { booking_date: '2026-07-15', tee_time: '08:00:00' },
      { timezone: PACIFIC, meeting_duration_mins: null },
    )
    const explicit = surveyDueAt(
      { booking_date: '2026-07-15', tee_time: '08:00:00' },
      { timezone: PACIFIC, meeting_duration_mins: DEFAULT_ROUND_MINUTES },
    )
    expect(withNulls.getTime()).toBe(explicit.getTime())
  })

  it('handles a round that runs past midnight in the course timezone', () => {
    // 9:00pm Pacific + 300 min + 5 min lands at 2:05am the next day.
    const due = surveyDueAt(
      { booking_date: '2026-07-15', tee_time: '21:00:00' },
      { timezone: PACIFIC, meeting_duration_mins: 300 },
    )
    expect(due.toISOString()).toBe('2026-07-16T09:05:00.000Z')
  })
})

describe('isSurveyDue', () => {
  const booking = { booking_date: '2026-07-15', tee_time: '13:35:00' }
  const course = { timezone: PACIFIC, meeting_duration_mins: 180 }
  const due = surveyDueAt(booking, course)

  it('is false while the round is still running', () => {
    const midRound = new Date(due.getTime() - 60 * 60 * 1000)
    expect(isSurveyDue(booking, course, midRound)).toBe(false)
  })

  it('is false during the grace period', () => {
    const justFinished = new Date(due.getTime() - (SURVEY_DELAY_MINUTES - 1) * 60_000)
    expect(isSurveyDue(booking, course, justFinished)).toBe(false)
  })

  it('is true from the due instant onwards', () => {
    expect(isSurveyDue(booking, course, due)).toBe(true)
    expect(isSurveyDue(booking, course, new Date(due.getTime() + 60_000))).toBe(true)
  })
})

// Every path that surveys a round — the popup, the push cron, and the submit
// endpoint — gates on this list, so it's the single place cancelled and
// never-played bookings are kept out.
describe('SURVEYABLE_BOOKING_STATUSES', () => {
  it('excludes cancelled rounds', () => {
    expect(SURVEYABLE_BOOKING_STATUSES).not.toContain('cancelled')
  })

  it('excludes bookings that never became a paid round', () => {
    for (const status of ['tentative', 'awaiting_approval', 'availability_confirmed', 'waitlist', 'pending']) {
      expect(SURVEYABLE_BOOKING_STATUSES).not.toContain(status)
    }
  })

  it('covers the statuses a played round ends in', () => {
    expect(SURVEYABLE_BOOKING_STATUSES).toContain('confirmed')
    expect(SURVEYABLE_BOOKING_STATUSES).toContain('payment_confirmed')
  })
})

// Whoever played the round is the one asked about it — the same rule the
// booking-reminders cron uses to decide who gets the tee-time reminder.
describe('surveyRecipientId', () => {
  const BOOKER = '11111111-1111-4111-8111-111111111111'
  const PLAYER = '22222222-2222-4222-8222-222222222222'

  it('is the booker when they played it themselves', () => {
    expect(surveyRecipientId({ member_id: BOOKER, player_member_id: null })).toBe(BOOKER)
    expect(surveyRecipientId({ member_id: BOOKER })).toBe(BOOKER)
  })

  it('is the named player when someone booked on their behalf', () => {
    expect(surveyRecipientId({ member_id: BOOKER, player_member_id: PLAYER })).toBe(PLAYER)
  })

  it('builds a filter matching exactly those two cases', () => {
    // Own booking with no separate player, OR listed as the player.
    expect(surveyRecipientFilter(BOOKER)).toBe(
      `and(player_member_id.is.null,member_id.eq.${BOOKER}),player_member_id.eq.${BOOKER}`,
    )
  })
})
