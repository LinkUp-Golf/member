import { AVIARA_TIMEZONE, GOLF_ROUND_DURATION_MINUTES } from '@/lib/constants'

export function resolveAppointmentIso(
  bookingDate: string,
  teeTime: string,
  timezone: string,
  durationMinutes: number,
): { startIso: string; endIso: string } {
  const time = teeTime.length === 5 ? `${teeTime}:00` : teeTime

  const noonUtc = new Date(`${bookingDate}T12:00:00Z`)
  const offsetRaw = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'shortOffset',
  })
    .formatToParts(noonUtc)
    .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+0'
  const offsetMatch = offsetRaw.match(/GMT([+-])(\d+)(?::(\d+))?/)
  const tzOffset = offsetMatch
    ? `${offsetMatch[1]}${(offsetMatch[2] ?? '0').padStart(2, '0')}${(offsetMatch[3] ?? '0').padStart(2, '0')}`
    : '+0000'

  const startIso = `${bookingDate}T${time}${tzOffset}`
  const [th, tm] = time.split(':').map(Number)
  const endMinutes = (th ?? 0) * 60 + (tm ?? 0) + durationMinutes
  const endIso = `${bookingDate}T${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}:00${tzOffset}`

  return { startIso, endIso }
}

// Backward-compatible alias for existing Aviara bookings
export function resolveAviaraAppointmentIso(
  bookingDate: string,
  teeTime: string,
): { startIso: string; endIso: string } {
  return resolveAppointmentIso(bookingDate, teeTime, AVIARA_TIMEZONE, GOLF_ROUND_DURATION_MINUTES)
}
