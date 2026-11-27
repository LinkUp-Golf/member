import { describe, it, expect } from 'vitest'
import {
  dueReminders,
  REMINDER_KINDS,
  reminderBody,
  reminderSubject,
  reminderTimes,
} from '@/lib/bookings/reminders'

// Pacific, in December: UTC-8.
const TZ = 'America/Los_Angeles'
const DAY = '2026-12-06'

describe('reminderTimes', () => {
  it('sends three reminders and none on the morning of the round', () => {
    expect(REMINDER_KINDS).toEqual(['7d', '3d', 'evening'])
  })

  it('counts 7 and 3 days back from the tee time', () => {
    const t = reminderTimes(DAY, '10:00:00', TZ)
    expect(t['7d'].toISOString()).toBe('2026-11-29T18:00:00.000Z')
    expect(t['3d'].toISOString()).toBe('2026-12-03T18:00:00.000Z')
  })

  it('sends the night-before reminder at 8 PM at the venue, whatever the tee time', () => {
    // 8 PM Pacific on the 5th is 04:00 UTC on the 6th.
    expect(reminderTimes(DAY, '07:30:00', TZ).evening.toISOString()).toBe('2026-12-06T04:00:00.000Z')
    expect(reminderTimes(DAY, '16:00:00', TZ).evening.toISOString()).toBe('2026-12-06T04:00:00.000Z')
  })

  it('finds the night before across a month boundary', () => {
    expect(reminderTimes('2026-12-01', '10:00:00', TZ).evening.toISOString()).toBe('2026-12-01T04:00:00.000Z')
  })
})

describe('dueReminders', () => {
  const evening = new Date('2026-12-06T04:00:00.000Z')

  it('sends a reminder from a few minutes before its moment', () => {
    expect(dueReminders(DAY, '10:00:00', TZ, {}, new Date(evening.getTime() - 5 * 60_000))).toEqual(['evening'])
  })

  it('still sends it if one cron run was missed', () => {
    expect(dueReminders(DAY, '10:00:00', TZ, {}, new Date(evening.getTime() + 20 * 60_000))).toEqual(['evening'])
  })

  it('gives up half an hour late, so a new booking never gets a stale reminder', () => {
    expect(dueReminders(DAY, '10:00:00', TZ, {}, new Date(evening.getTime() + 31 * 60_000))).toEqual([])
  })

  it('does not send one twice', () => {
    expect(dueReminders(DAY, '10:00:00', TZ, { evening: true }, evening)).toEqual([])
  })
})

describe('wording', () => {
  it("reads the way the client wrote it", () => {
    expect(reminderBody('Park Hyatt Aviara', 'Saturday, December 6', '10:00 AM')).toBe(
      "You're playing golf at Park Hyatt Aviara on Saturday, December 6 and your tee time is 10:00 AM. Please arrive 30 minutes early for warm up and introductions. Hit 'em straight!",
    )
  })

  it('gives the night-before reminder a subject that says tomorrow', () => {
    expect(reminderSubject('evening', 'Aviara', 'Saturday, December 6', '10:00 AM')).toBe(
      'Tomorrow at Aviara: your tee time is 10:00 AM',
    )
    expect(reminderSubject('3d', 'Aviara', 'Saturday, December 6', '10:00 AM')).toBe(
      'Reminder: Aviara on Saturday, December 6 at 10:00 AM',
    )
  })
})
