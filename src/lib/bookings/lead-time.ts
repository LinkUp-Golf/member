// How close to a round a member can still be the first to book it.
//
// A day inside the next three is a day the club is already planning for. A
// member joining a group that's going out is fine — the tee time is held, the
// people are coming, one more seat costs nobody anything. A member *starting* a
// round at that notice is a different request: it asks the venue for a slot
// nobody had asked for, two days out, for a group of one.
//
// So the rule is about the day rather than the member: inside the window, a
// venue-day with no bookings on it is closed, and a venue-day with any booking
// on it stays open to everyone. Nothing about who is asking, and nothing to
// override — the first booking is what opens the day, and inside the window
// there is no way to make one.
//
// Outside the window nothing changes. Everything here reduces to "true" for a
// date more than the window away, which is the great majority of the calendar.
//
// Pure, and the one definition: the month grid, the single-date filter and
// POST /api/bookings/create all read it, so a day can't be offered by one and
// refused by another.

/**
 * How many days ahead the rule applies, counting today.
 *
 * Three means today, tomorrow and the day after. A date four days out is
 * outside it and behaves as it always did.
 */
export const JOIN_ONLY_WINDOW_DAYS = 3

/**
 * Whole days from `today` to `date`, both 'YYYY-MM-DD'.
 *
 * Parsed as UTC midnights so the arithmetic is on calendar days and not on
 * elapsed time: both strings are already wall-clock dates at the venue, and
 * re-introducing a timezone here is how a day either side of a DST change ends
 * up 23 or 25 hours long. Negative for a date already past.
 */
export function daysUntil(date: string, today: string): number {
  const a = Date.parse(`${today}T00:00:00Z`)
  const b = Date.parse(`${date}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN
  return Math.round((b - a) / 86_400_000)
}

/**
 * Whether this date is close enough for the rule to apply.
 *
 * A date in the past is not "inside the window" — it's gone, and the calendar
 * has already closed it for a different reason. An unparseable date is treated
 * as inside, because the safe answer to "should I let someone book a date I
 * can't read" is no.
 */
export function isInsideJoinOnlyWindow(
  date: string,
  today: string,
  windowDays: number = JOIN_ONLY_WINDOW_DAYS,
): boolean {
  if (windowDays <= 0) return false
  const days = daysUntil(date, today)
  if (Number.isNaN(days)) return true
  return days >= 0 && days < windowDays
}

/**
 * Whether a member may book this venue on this day.
 *
 * `bookedSpots` is every booking row holding a seat that day — the same count
 * the daily cap is measured against. One is enough: the round exists, and the
 * question this answers is only whether someone has to start it.
 *
 * windowDays of 0 switches the rule off, which is what the host path passes:
 * a host listing a round is the thing that creates the interest in the first
 * place, and refusing them for want of a booking would make the rule
 * self-defeating.
 */
export function dayIsBookable(params: {
  /** 'YYYY-MM-DD' at the venue. */
  date: string
  /** 'YYYY-MM-DD' at the venue, now. */
  today: string
  bookedSpots: number
  windowDays?: number
}): boolean {
  if (!isInsideJoinOnlyWindow(params.date, params.today, params.windowDays)) return true
  return params.bookedSpots > 0
}

/** What a member is told when the day they picked has nobody on it yet. */
export function joinOnlyWindowMessage(windowDays: number = JOIN_ONLY_WINDOW_DAYS): string {
  return `Tee times within ${windowDays} days can only be joined, not started — nobody has booked this day yet. Pick a later date, or a day that already has players on it.`
}
