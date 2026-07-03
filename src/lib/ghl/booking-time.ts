import { addMinutes } from 'date-fns'
import { fromZonedTime, formatInTimeZone } from 'date-fns-tz'
import { AVIARA_TIMEZONE, GOLF_ROUND_DURATION_MINUTES } from '@/lib/constants'

// GHL expects "YYYY-MM-DDTHH:MM:SS±HHMM" (the 'xx' token — always a numeric
// offset, never 'Z', no colon).
const GHL_ISO_FORMAT = "yyyy-MM-dd'T'HH:mm:ssxx"

export function resolveAppointmentIso(
  bookingDate: string,
  teeTime: string,
  timezone: string,
  durationMinutes: number,
): { startIso: string; endIso: string } {
  const time = teeTime.length === 5 ? `${teeTime}:00` : teeTime

  // fromZonedTime resolves the real UTC instant for this course-local wall
  // clock time, so addMinutes below rolls over midnight/month/year exactly
  // like any other Date arithmetic — no manual overflow math needed for
  // late tee times + a long round duration pushing past midnight.
  const startUtc = fromZonedTime(`${bookingDate}T${time}`, timezone)
  const endUtc = addMinutes(startUtc, durationMinutes)

  return {
    startIso: formatInTimeZone(startUtc, timezone, GHL_ISO_FORMAT),
    endIso: formatInTimeZone(endUtc, timezone, GHL_ISO_FORMAT),
  }
}

// Backward-compatible alias for existing Aviara bookings
export function resolveAviaraAppointmentIso(
  bookingDate: string,
  teeTime: string,
): { startIso: string; endIso: string } {
  return resolveAppointmentIso(bookingDate, teeTime, AVIARA_TIMEZONE, GOLF_ROUND_DURATION_MINUTES)
}
