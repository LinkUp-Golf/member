// A day, arranged the way a tee sheet is.
//
// The "who's playing" sheet on /book used to be a grouping written inside the
// component: venue, then tee time, then whoever was booked. Adding the host to
// the head of each tee time added two rules that are easy to get subtly wrong
// and invisible when they are — the host has to come first, and a host who has
// also booked a round must not appear twice — so the arrangement moved here,
// where it can be checked.
//
// It also reconciles the list with the count beside it. The day cell says "4/12"
// from seats held against the venue's cap; this list can only name members whose
// round is going ahead. The difference is real — a guest has no profile, and a
// booking awaiting approval still holds its seat — so it's counted and said
// rather than left as two numbers that don't match.
//
// Pure. It takes the day's players, who runs each venue and what each venue's
// day holds, and returns the order. Names and colours stay with the component:
// those are how a venue is drawn, not how the day is arranged.

import type { DaySeats } from './occupancy'
import type { CalendarPlayer } from './players'
import type { VenueHost } from './venue-hosts'

export interface TeeGroup {
  /** Wall-clock 'HH:mm:ss' at the venue. */
  teeTime: string
  /** Everyone who has joined, the host excluded — they're named above. */
  players: CalendarPlayer[]
}

export interface VenueTeeSheet {
  courseId: string
  /** Null for a venue whose GHL calendar names nobody. */
  host: VenueHost | null
  /**
   * True when the viewer is this venue's host.
   *
   * Only knowable when the host has also booked a round here, since that's the
   * only place a day's players say which one is the viewer. That's also the only
   * case where it matters: it's when they'd otherwise see themselves twice.
   */
  hostIsSelf: boolean
  tees: TeeGroup[]
  /**
   * Seats taken and seats the day holds here — the same two numbers the day cell
   * prints as "3/12" — or null when the caller didn't say.
   */
  seats: DaySeats | null
  /**
   * Seats this sheet accounts for by name: one per member per tee time, which is
   * what the rows below add up to. The host counts here only if they booked a
   * round of their own, because that's the seat they'd be occupying.
   */
  listedSeats: number
  /**
   * Seats taken that no name can be put to: a non-member guest (who has no
   * profile to list) and a round that isn't going ahead yet (which still holds
   * its seat against the venue's cap). Named rather than hidden — a cell reading
   * 4/12 beside a list of two people is the kind of disagreement that makes a
   * member distrust both numbers.
   */
  unnamedSeats: number
}

/**
 * The day's venues, each with its host, its tee times and its seat count.
 *
 * Venues come out in the order their first player appears, which the caller is
 * expected to re-sort — it sorts by name, and the name isn't known here. Tee
 * times keep the order the players arrived in, which loadPlayersForRange has
 * already sorted by time and then name, so each group reads as its tee sheet
 * does.
 *
 * `seatsByVenue` is what the day cell counted: pass it and each venue carries
 * its own "3 of 12", plus however many of those seats this list can't name. A
 * venue it mentions is returned even with nobody to list, as long as somebody is
 * on it — a round of two guests is still a round, and a day that says it's full
 * must be able to show why. A venue with no seats and no players is not
 * returned: "who's playing" at a venue nobody has booked is nobody.
 */
export function buildTeeSheet(
  players: readonly CalendarPlayer[],
  hostByVenue?: ReadonlyMap<string, VenueHost> | null,
  seatsByVenue?: ReadonlyMap<string, DaySeats> | null,
): VenueTeeSheet[] {
  const byVenue = new Map<string, Map<string, CalendarPlayer[]>>()
  for (const p of players) {
    const tees = byVenue.get(p.courseId) ?? new Map<string, CalendarPlayer[]>()
    const list = tees.get(p.teeTime) ?? []
    list.push(p)
    tees.set(p.teeTime, list)
    byVenue.set(p.courseId, tees)
  }

  // A venue whose seats are all taken by people this list can't name has no
  // players and still belongs on the sheet.
  for (const [courseId, seats] of seatsByVenue ?? []) {
    if (seats.bookedSpots > 0 && !byVenue.has(courseId)) {
      byVenue.set(courseId, new Map())
    }
  }

  const sheets: VenueTeeSheet[] = []
  for (const [courseId, tees] of byVenue) {
    const host = hostByVenue?.get(courseId) ?? null
    const hostMemberId = host?.memberId ?? null
    const seats = seatsByVenue?.get(courseId) ?? null

    // One per member per tee time, the host's own booking included: these are
    // the seats the rows below account for, however they're arranged.
    let listedSeats = 0
    for (const group of tees.values()) listedSeats += group.length

    sheets.push({
      courseId,
      host,
      hostIsSelf:
        !!hostMemberId && players.some(p => p.memberId === hostMemberId && p.isSelf),
      tees: Array.from(tees, ([teeTime, group]) => ({
        teeTime,
        players: hostMemberId ? group.filter(p => p.memberId !== hostMemberId) : group,
      })),
      seats,
      listedSeats,
      unnamedSeats: Math.max(0, (seats?.bookedSpots ?? 0) - listedSeats),
    })
  }
  return sheets
}

/**
 * How many people a day's rows are, rather than how many rows.
 *
 * The day arrives as one entry per member per venue per tee time, so a member
 * out twice — two tee times, or two clubs on one day — is two entries and one
 * person. The sheet's header counts people, and counting the rows made it
 * disagree with the faces that opened it, which dedupe per venue.
 */
export function distinctPlayers(players: readonly CalendarPlayer[]): number {
  return new Set(players.map(p => p.memberId)).size
}
