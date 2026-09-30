// How full a day is, said the same way everywhere.
//
// The month grid used to label a day "1P" or "2Ps" — how many members were
// booked, and nothing about how much room was left. It answered "is anyone
// there" when the question a member has in front of a calendar is "can I get
// in, and is it worth going". So the cell now reads "3/12": seats taken out of
// seats the day can hold.
//
// Its own module because both sides need the same arithmetic and neither can
// import the other's: the numbers are computed server-side in
// ./availability (which pulls in GHL and the service-role client, so a client
// component must not import it), and rendered by VenueAvailabilityCalendar,
// which deliberately keeps its own copy of the payload's shapes so it stays a
// presentational unit. Pure, so it can be tested without either.

/** The two numbers a venue-day contributes. Structurally a CalendarOpening. */
export interface DaySeats {
  bookedSpots: number
  totalSpots: number
}

export interface DayOccupancy {
  /** Seats taken across the venues the day lists. */
  taken: number
  /** Seats those venues can hold between them. */
  total: number
}

/**
 * A whole day's occupancy, across every venue it lists.
 *
 * Only the venues the day lists, which is the same set the cell's dots and
 * chips show — a venue with nothing left that day isn't on the calendar at all,
 * so its seats are in neither number. That keeps the tally and the thing beside
 * it describing the same day rather than two different ones.
 */
export function dayOccupancy(openings: readonly DaySeats[]): DayOccupancy {
  let taken = 0
  let total = 0
  for (const o of openings) {
    taken += Math.max(0, o.bookedSpots)
    total += Math.max(0, o.totalSpots)
  }
  return { taken, total }
}

/**
 * The tally as the cell prints it: "3/12".
 *
 * Returns '' when the day can't seat anyone, so a cell with nothing to say says
 * nothing rather than "0/0". Clamped, because a number above its own total
 * would be read as a bug in the calendar rather than in whatever produced it.
 */
export function occupancyTally(occupancy: DayOccupancy): string {
  const { taken, total } = occupancy
  if (total <= 0) return ''
  return `${Math.min(taken, total)}/${total}`
}

/** The same thing in words, for the day's accessible label. */
export function occupancyLabel(occupancy: DayOccupancy): string {
  const { taken, total } = occupancy
  if (total <= 0) return ''
  const seated = Math.min(taken, total)
  return `${seated} of ${total} spot${total === 1 ? '' : 's'} taken`
}
