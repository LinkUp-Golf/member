import { describe, it, expect } from 'vitest'
import { remindersToSwitchOff } from '@/lib/ghl/calendar-notifications'

describe('remindersToSwitchOff', () => {
  it('switches off an active reminder that leaves GHL', () => {
    expect(remindersToSwitchOff([
      { _id: 'email', notificationType: 'reminder', channel: 'email', isActive: true, deleted: false },
      { _id: 'sms', notificationType: 'reminder', channel: 'sms', isActive: true },
    ])).toEqual(['email', 'sms'])
  })

  it('leaves bookings, cancellations and the rest alone', () => {
    expect(remindersToSwitchOff([
      { _id: 'b', notificationType: 'booked', channel: 'email', isActive: true },
      { _id: 'c', notificationType: 'cancellation', channel: 'email', isActive: true },
      { _id: 'f', notificationType: 'followup', channel: 'email', isActive: true },
    ])).toEqual([])
  })

  it('skips reminders already off or deleted, and in-app ones for staff', () => {
    expect(remindersToSwitchOff([
      { _id: 'off', notificationType: 'reminder', channel: 'email', isActive: false },
      { _id: 'gone', notificationType: 'reminder', channel: 'email', isActive: true, deleted: true },
      { _id: 'staff', notificationType: 'reminder', channel: 'inApp', isActive: true },
    ])).toEqual([])
  })
})
