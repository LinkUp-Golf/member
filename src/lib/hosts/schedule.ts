// Whether two hosted rounds can share a venue.
//
// A host's round is a block of the club's day: the tee time it goes off at,
// plus however long a round there takes (courses.meeting_duration_mins, the
// same figure the GHL calendar is built from). Two hosts holding overlapping
// blocks at the same club is not a scheduling preference — it is the same tee
// sheet sold twice, and it only becomes visible when the second calendar is
// created against a venue the first one already owns.
//
// So the rule is checked wherever a round enters the system: when a host lists
// dates, when an admin approves an application that carries rounds, and — the
// one that matters most — before a venue's calendar is created, because that is
// the point of no return.
//
// Pure rules here, with one loader at the bottom. Dependency-free apart from
// tee-time parsing, so the routes and the tests read the same rules.

import type { SupabaseClient } from '@supabase/supabase-js'
import { isTeeTime, normaliseTeeTime } from '@/lib/hosts/tee-time'

/**
 * Statuses that hold a block of the venue's day.
 *
 * A round awaiting approval counts: it was submitted first, and approving a
 * second one over the top of it is exactly the collision this prevents. A
 * cancelled round holds nothing, and a round that has already run is history.
 */
export const OCCUPYING_STATUSES = ['pending_approval', 'upcoming'] as const

/** How long a round is assumed to run when the venue hasn't said. */
export const FALLBACK_ROUND_MINUTES = 240

export interface ScheduledRound {
  /** 'YYYY-MM-DD'. */
  date: string
  /** 'HH:MM', or null/'' for a row written before tee times were required. */
  teeTime: string | null
}

/** An existing round, named well enough to say who it belongs to. */
export interface ExistingRound extends ScheduledRound {
  eventId: string
  hostId: string
  hostName: string
}

/**
 * A round being checked. It may not exist yet — a host submitting dates has no
 * event ids — and where it does, the id is what stops a round already on the
 * books from being reported as clashing with itself.
 */
export interface ProposedRound extends ScheduledRound {
  eventId?: string
  hostId?: string
  hostName?: string
}

export interface RoundWindow {
  date: string
  /** Minutes past midnight at the venue. */
  startMins: number
  endMins: number
  /**
   * True when the round has no tee time, so it's taken to hold the whole day.
   *
   * Deliberately the cautious reading. A round with no time is one nobody can
   * be scheduled around, and the answer to "does this collide?" cannot be no.
   * Every round created since tee times became required carries one, so this
   * only bites on rows written before that — where flagging the day and having
   * someone look is the outcome we want anyway.
   */
  wholeDay: boolean
}

const minutesOf = (teeTime: string): number => {
  const [hours = '0', minutes = '0'] = normaliseTeeTime(teeTime).split(':')
  return Number(hours) * 60 + Number(minutes)
}

/** The block of the day a round holds. */
export function roundWindow(round: ScheduledRound, durationMins: number): RoundWindow {
  const date = round.date.slice(0, 10)
  const length = Number.isFinite(durationMins) && durationMins > 0 ? durationMins : FALLBACK_ROUND_MINUTES

  if (!isTeeTime(round.teeTime)) {
    return { date, startMins: 0, endMins: 24 * 60, wholeDay: true }
  }
  const start = minutesOf(round.teeTime)
  return { date, startMins: start, endMins: start + length, wholeDay: false }
}

/**
 * Do these two blocks collide? Half-open, so a round that ends exactly as the
 * next tees off is fine — that's a following group, not a double-booking.
 */
export function windowsOverlap(a: RoundWindow, b: RoundWindow): boolean {
  if (a.date !== b.date) return false
  return a.startMins < b.endMins && b.startMins < a.endMins
}

export interface RoundConflict {
  /** The round being proposed. */
  round: ProposedRound
  /** The round already holding that block. */
  existing: ExistingRound
}

/**
 * Every proposed round that collides with one already on the books, plus the
 * round it collides with. Empty means the set is clear to create.
 *
 * Proposed rounds are checked against each other too: an admin approving an
 * application, or a venue with two hosts waiting on its first calendar, can be
 * handed a set that's internally inconsistent — and nothing else would catch
 * it, since neither round exists yet.
 */
export function findRoundConflicts(
  proposed: ProposedRound[],
  existing: ExistingRound[],
  durationMins: number,
): RoundConflict[] {
  const conflicts: RoundConflict[] = []
  // Rounds holding a block: the ones already on the books, and each proposed
  // round as it comes through — so the second of two identical proposals is
  // caught by the first rather than by nothing.
  const held: ExistingRound[] = [...existing]

  proposed.forEach((round, index) => {
    const window = roundWindow(round, durationMins)
    const clash = held.find(
      other =>
        // A round already on the books is not a clash with itself.
        (!round.eventId || other.eventId !== round.eventId) &&
        windowsOverlap(window, roundWindow(other, durationMins)),
    )
    if (clash) conflicts.push({ round, existing: clash })
    // Pushed whether or not it clashed: a third round over the same block
    // should be told about the first one it hits, not let through because the
    // second was already refused.
    held.push({
      ...round,
      eventId: round.eventId ?? `proposed:${index}`,
      hostId: round.hostId ?? '',
      hostName: round.hostName ?? 'another host',
    })
  })

  return conflicts
}

/** Said the same way to a host and to an admin — both need the date and the who. */
export function describeRoundConflict(conflict: RoundConflict, courseName: string): string {
  const { round, existing } = conflict
  const when = isTeeTime(round.teeTime)
    ? `${round.date} at ${normaliseTeeTime(round.teeTime)}`
    : round.date
  const theirs = isTeeTime(existing.teeTime)
    ? `${normaliseTeeTime(existing.teeTime)}`
    : 'a round with no set tee time'
  return (
    `${when} clashes with ${existing.hostName} at ${courseName} (${theirs}). ` +
    `Two hosts can't hold the same tee sheet — pick another time or another day.`
  )
}

/**
 * The rounds already holding blocks at a venue on the given dates.
 *
 * Every host's, not just the caller's: the point is to find the other host. The
 * event ids passed in `exclude` are skipped, which is what lets an edit, or a
 * re-run of an approval, check a round against the world without checking it
 * against itself.
 */
export async function loadOccupyingRounds(
  admin: SupabaseClient,
  params: { courseId: string; dates: string[]; exclude?: string[] },
): Promise<ExistingRound[]> {
  const dates = Array.from(new Set(params.dates.map(d => d.slice(0, 10))))
  if (dates.length === 0) return []

  const { data } = await admin
    .from('hosted_events')
    .select('id, host_id, event_date, tee_time, host:hosts(name)')
    .eq('course_id', params.courseId)
    .in('event_date', dates)
    .in('status', [...OCCUPYING_STATUSES])

  const excluded = new Set(params.exclude ?? [])

  return (data ?? [])
    .filter(row => !excluded.has(row.id as string))
    .map(row => {
      const host = Array.isArray(row.host) ? row.host[0] : row.host
      return {
        eventId: row.id as string,
        hostId: row.host_id as string,
        hostName: (host as { name?: string } | null)?.name ?? 'another host',
        date: String(row.event_date).slice(0, 10),
        teeTime: (row.tee_time as string | null) ?? null,
      }
    })
}

// ---- The host's availability, as GHL wants it ----------------
//
// A calendar staffed by a host is bookable whenever GHL thinks that host is
// working, which by default is every weekday all day. A host runs rounds on the
// handful of dates they listed, at one tee time each — so the calendar has to be
// told exactly that, or it offers members slots on days nobody is at the club.
//
// GHL takes this as a schedule of date rules, each carrying the intervals the
// user is available in (POST /calendars/schedules). One rule per date, one
// interval per tee time, each interval the length of a tee time.

export interface AvailabilityInterval {
  /** 'HH:MM'. */
  from: string
  to: string
}

export interface AvailabilityRule {
  type: 'date'
  /** 'YYYY-MM-DD'. */
  date: string
  intervals: AvailabilityInterval[]
}

const clockOf = (minsPastMidnight: number): string => {
  // A tee time plus a slot can't run into the next day — a date rule has no way
  // to say so — and a round teeing off at 23:50 is not a real case anyway.
  const capped = Math.min(Math.max(minsPastMidnight, 0), 23 * 60 + 59)
  const hours = Math.floor(capped / 60)
  const mins = capped % 60
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
}

/**
 * The host's rounds as availability rules, sorted and deduplicated.
 *
 * `slotMins` is one tee time — GHL_CALENDAR_RULES.slotDuration, the same figure
 * the calendar is created with, so an interval is exactly the slot it has to
 * hold open.
 *
 * A round with no usable tee time is left out rather than given the whole day:
 * these rules are what a member is offered, and opening a club's entire day
 * because one old row has no time would sell tee times that don't exist.
 * roundWindow takes the opposite view for the same field, and deliberately —
 * there the question is "might this collide", where the cautious answer is yes.
 */
export function availabilityRules(
  rounds: ScheduledRound[],
  slotMins: number,
): AvailabilityRule[] {
  const length = Number.isFinite(slotMins) && slotMins > 0 ? slotMins : 0
  const byDate = new Map<string, Map<string, AvailabilityInterval>>()

  for (const round of rounds) {
    if (!isTeeTime(round.teeTime)) continue
    const date = round.date.slice(0, 10)
    const start = minutesOf(round.teeTime)
    const interval: AvailabilityInterval = {
      from: clockOf(start),
      to: clockOf(start + length),
    }
    // Keyed on the interval itself: two hosted rounds at one venue on one date
    // and time is a duplicate listing, not two windows.
    const intervals = byDate.get(date) ?? new Map<string, AvailabilityInterval>()
    intervals.set(`${interval.from}-${interval.to}`, interval)
    byDate.set(date, intervals)
  }

  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, intervals]) => ({
      type: 'date' as const,
      date,
      intervals: Array.from(intervals.values()).sort((a, b) => a.from.localeCompare(b.from)),
    }))
}
