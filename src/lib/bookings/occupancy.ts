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

/** The one number that decides whether a venue-day can be booked. */
export interface DayOpening {
  openSpots: number
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
 * Only the venues the day lists, which is the same set the cell's dots and chips
 * show. Those now include a venue that's full, whose seats are all in `taken` and
 * which reads as "3/3" rather than vanishing — a round that's happening is part
 * of how full the day is. That keeps the tally and the thing beside it describing
 * the same day rather than two different ones.
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

/**
 * Whether this venue-day is full: a round is happening and nothing is left.
 *
 * The month payload lists a full venue-day on purpose (see
 * venueAvailabilityForMonth), so every surface that offers a booking asks this
 * first. Written as a negation of "has seats" so a missing or NaN count reads as
 * full — the safe answer, since the alternative is offering a booking the
 * database will refuse.
 */
export function openingIsFull(opening: DayOpening): boolean {
  return !(opening.openSpots > 0)
}

/** How a day divides: venues that can be booked, and venues merely playing. */
export function daySplit(
  openings: readonly DayOpening[],
): { bookable: number; full: number } {
  let bookable = 0
  for (const o of openings) if (!openingIsFull(o)) bookable++
  return { bookable, full: openings.length - bookable }
}

/**
 * How full a day is, as a proportion — 0 to 100, rounded.
 *
 * What the month grid draws below md, where "3/12" has nowhere legible to sit: a
 * cell there is about 46px wide and already carries a date and a venue dot, so
 * the fraction went in the corner at 9px, against the date, and read as noise on
 * every day of the month. A bar says the same thing in the space a bar needs, and
 * the exact numbers stay where there's room for them: the cell from md up, the
 * day's agenda card, and the accessible label on every width.
 */
export function occupancyPercent(occupancy: DayOccupancy): number {
  const { taken, total } = occupancy
  if (total <= 0) return 0
  return Math.round((Math.min(Math.max(taken, 0), total) / total) * 100)
}

/** At what point a day reads as nearly gone rather than open. */
export const OCCUPANCY_BUSY_RATIO = 0.75

export type OccupancyLevel = 'open' | 'busy' | 'full'

/**
 * Which of three things a day is, for the bar's colour.
 *
 * Three rather than a gradient because three is what a member does something
 * different about: book it, book it today, or look at another day. A day with no
 * seats at all is 'full' — it's on the calendar because a round is happening on
 * it (see venueAvailabilityForMonth), not because anything can be booked.
 */
export function occupancyLevel(occupancy: DayOccupancy): OccupancyLevel {
  const { taken, total } = occupancy
  if (total <= 0) return 'full'
  if (taken >= total) return 'full'
  return taken / total >= OCCUPANCY_BUSY_RATIO ? 'busy' : 'open'
}
