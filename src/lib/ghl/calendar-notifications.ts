// Which of a GHL calendar's own notifications the app switches off. Pure, so
// it's tested.
//
// GHL gives every new calendar a "Reminder" email to the contact 10 minutes
// before the appointment, in its own template ("Reminder: Upcoming Appointment
// on …"). The app sends its own reminders (src/lib/bookings/reminders.ts: 7
// days, 3 days and the night before), and a member had one of GHL's land 10
// minutes before his tee time — so on 2026-11-27 it was switched off on every
// calendar by hand, and createGHLCalendar switches it off on each one it makes.
//
// Only reminders, and only the ones that leave GHL (email, SMS, WhatsApp).
// The in-app ones go to the calendar's staff inside GHL and reach no member.

export interface GHLCalendarNotification {
  _id: string
  notificationType?: string
  channel?: string
  isActive?: boolean
  deleted?: boolean
}

export function remindersToSwitchOff(notifications: GHLCalendarNotification[]): string[] {
  return notifications
    .filter((n) =>
      n.notificationType === 'reminder' &&
      n.isActive === true &&
      n.deleted !== true &&
      n.channel !== 'inApp')
    .map((n) => n._id)
}
