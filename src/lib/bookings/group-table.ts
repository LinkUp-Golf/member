// The group table after golf: when a member is asked to hold a seat at it.
//
// On a day with more than one foursome we reserve a table for drinks or dinner
// after the round, and the booking confirmation asks each member whether to
// keep them a seat. A single foursome needs no reservation — the restaurant can
// almost always seat four — so on those days the question isn't asked.
//
// "Foursomes" are tee times on the venue's calendar that day: the ones already
// booked and the ones still open, counted once each. Booked tee times have to be
// read from our own rows, because a tee time that has filled drops out of GHL's
// free slots — counting only the open ones would make a day with two full
// foursomes look like it had none.
//
// Pure, so the rule is pinned by its tests. POST /api/bookings/create gathers
// the times and answers `groupTable` on its response.

/** Fewest tee times in a day for the group table to be reserved. */
export const GROUP_TABLE_MIN_TEE_TIMES = 2

/** 'HH:MM' from 'HH:MM', 'HH:MM:SS' or 'H:MM' — seconds never tell two tee times apart. */
function teeTimeKey(time: string): string {
  const [hh = '0', mm = '0'] = time.trim().split(':')
  return `${hh.padStart(2, '0')}:${mm.padStart(2, '0')}`
}

/**
 * Distinct tee times on a venue's day: those holding a booking and those the
 * calendar still offers, each counted once however many seats it has.
 */
export function teeTimesOnDay(bookedTeeTimes: string[], openTeeTimes: string[]): number {
  const keys = new Set<string>()
  for (const t of [...bookedTeeTimes, ...openTeeTimes]) {
    if (t && t.trim()) keys.add(teeTimeKey(t))
  }
  return keys.size
}

/** Whether a day with this many tee times reserves the group table. */
export function offersGroupTable(teeTimeCount: number): boolean {
  return teeTimeCount >= GROUP_TABLE_MIN_TEE_TIMES
}
