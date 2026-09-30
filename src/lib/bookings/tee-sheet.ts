// A day, arranged the way a tee sheet is.
//
// The "who's playing" sheet on /book used to be a grouping written inside the
// component: venue, then tee time, then whoever was booked. Adding the host to
// the head of each tee time added two rules that are easy to get subtly wrong
// and invisible when they are — the host has to come first, and a host who has
// also booked a round must not appear twice — so the arrangement moved here,
// where it can be checked.
//
// Pure. It takes the day's players and who runs each venue, and returns the
// order. Names and colours stay with the component: those are how a venue is
// drawn, not how the day is arranged.

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
}

/**
 * The day's venues, each with its host and its tee times.
 *
 * Venues come out in the order their first player appears, which the caller is
 * expected to re-sort — it sorts by name, and the name isn't known here. Tee
 * times keep the order the players arrived in, which loadPlayersForRange has
 * already sorted by time and then name, so each group reads as its tee sheet
 * does.
 *
 * A venue with a host and no players is not returned: this arranges a day that
 * has people on it, and "who's playing" at a venue nobody has booked is nobody.
 */
export function buildTeeSheet(
  players: readonly CalendarPlayer[],
  hostByVenue?: ReadonlyMap<string, VenueHost> | null,
): VenueTeeSheet[] {
  const byVenue = new Map<string, Map<string, CalendarPlayer[]>>()
  for (const p of players) {
    const tees = byVenue.get(p.courseId) ?? new Map<string, CalendarPlayer[]>()
    const list = tees.get(p.teeTime) ?? []
    list.push(p)
    tees.set(p.teeTime, list)
    byVenue.set(p.courseId, tees)
  }

  const sheets: VenueTeeSheet[] = []
  for (const [courseId, tees] of byVenue) {
    const host = hostByVenue?.get(courseId) ?? null
    const hostMemberId = host?.memberId ?? null

    sheets.push({
      courseId,
      host,
      hostIsSelf:
        !!hostMemberId && players.some(p => p.memberId === hostMemberId && p.isSelf),
      tees: Array.from(tees, ([teeTime, group]) => ({
        teeTime,
        players: hostMemberId ? group.filter(p => p.memberId !== hostMemberId) : group,
      })),
    })
  }
  return sheets
}
