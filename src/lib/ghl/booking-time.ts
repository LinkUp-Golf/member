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

  // Roll over into the next calendar day(s) instead of producing an
  // out-of-range hour (e.g. "25:00") — an invalid ISO timestamp GHL would
  // reject or misinterpret. Late tee times + a long round duration can push
  // the end time past midnight.
  const daysOverflow = Math.floor(endMinutes / 1440)
  const endMinutesInDay = endMinutes % 1440
  const endDateStr = daysOverflow > 0
    ? new Date(new Date(`${bookingDate}T12:00:00Z`).getTime() + daysOverflow * 86400000)
      .toISOString().slice(0, 10)
    : bookingDate
  const endIso = `${endDateStr}T${String(Math.floor(endMinutesInDay / 60)).padStart(2, '0')}:${String(endMinutesInDay % 60).padStart(2, '0')}:00${tzOffset}`

  return { startIso, endIso }
}

// Backward-compatible alias for existing Aviara bookings
export function resolveAviaraAppointmentIso(
  bookingDate: string,
  teeTime: string,
): { startIso: string; endIso: string } {
  return resolveAppointmentIso(bookingDate, teeTime, AVIARA_TIMEZONE, GOLF_ROUND_DURATION_MINUTES)
}
