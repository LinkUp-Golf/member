// Tee-time availability for a course on a given date.
//
// Two callers need the same answer and must not diverge: the booking screen
// asks "what can I book at this course this month", and the event list asks
// "which courses have anything open on this date". They agree on one rule —
// a course with curated (custom) slots uses those on the dates it has curated
// and its GHL calendar everywhere else.

import { fromZonedTime, formatInTimeZone } from 'date-fns-tz'
import { getAvailableSlots } from '@/lib/ghl/client'
import { getCache, withCache } from '@/lib/cache'
import { GHL_SLOTS_NS, GHL_SLOTS_TTL_MS, ghlSlotsKey, ghlSlotsMonthKey } from '@/lib/cache/keys'
import { AVIARA_TIMEZONE, FALLBACK_ROUND_DURATION_MINUTES, DEFAULT_MAX_PLAYERS_PER_DAY } from '@/lib/constants'
import type { createAdminClient } from '@/lib/supabase-server'
import type { Course, GHLBookingSlot } from '@/types'

type AdminClient = ReturnType<typeof createAdminClient>

// Statuses that don't hold a seat, so they don't count against a day's cap or
// a curated tee time's seats.
const NON_HOLDING_STATUSES = '(cancelled,waitlist)'

// How many courses we ask GHL about at once when filtering by date. One call
// per course is unavoidable — GHL has no cross-calendar availability endpoint —
// so this bounds the burst rather than eliminating it.
const GHL_CONCURRENCY = 5

/**
 * Postgres `time` values come back as 'HH:MM:SS'; a curated tee_time stored as
 * 'HH:MM' is normalised to the same so the two match when counting booked seats.
 */
export function normaliseTime(t: string): string {
  const parts = t.split(':')
  const hh = (parts[0] ?? '00').padStart(2, '0')
  const mm = (parts[1] ?? '00').padStart(2, '0')
  const ss = (parts[2] ?? '00').padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

/** True if any slot in the list can still be booked. */
export function hasOpenSlot(slots: GHLBookingSlot[] | undefined | null): boolean {
  return (slots ?? []).some(s => s.available && (s.spotsOpen ?? 0) > 0)
}

/**
 * Builds a slot map for ONLY the dates a custom course has curated, keyed by
 * date and matching the shape getAvailableSlots returns so the caller can
 * overlay it onto the GHL slots (curated dates replace GHL; uncurated dates are
 * absent here and so keep their GHL slots). spotsOpen for each curated tee time
 * is its configured seats minus the players already booked at that exact
 * course+date+tee_time.
 */
export async function buildCustomSlots(
  admin: AdminClient,
  courseId: string,
  startDate: string,
  endDate: string,
  timezone: string,
  durationMins: number,
): Promise<Record<string, GHLBookingSlot[]>> {
  const [{ data: customRows }, { data: bookingRows }] = await Promise.all([
    admin
      .from('course_custom_slots')
      .select('slot_date, tee_time, seats')
      .eq('course_id', courseId)
      .gte('slot_date', startDate)
      .lte('slot_date', endDate),
    admin
      .from('bookings')
      .select('booking_date, tee_time')
      .eq('course_id', courseId)
      .gte('booking_date', startDate)
      .lte('booking_date', endDate)
      .not('status', 'in', NON_HOLDING_STATUSES),
  ])

  // How many seats are already taken per (date, tee_time).
  const booked = new Map<string, number>()
  for (const row of bookingRows ?? []) {
    const key = `${row.booking_date}|${normaliseTime(row.tee_time as string)}`
    booked.set(key, (booked.get(key) ?? 0) + 1)
  }

  const result: Record<string, GHLBookingSlot[]> = {}
  for (const row of customRows ?? []) {
    const time = normaliseTime(row.tee_time as string)
    const used = booked.get(`${row.slot_date}|${time}`) ?? 0
    const spotsOpen = Math.max(0, (row.seats as number) - used)

    // Same offset-bearing ISO shape getAvailableSlots emits, in the course's tz.
    const startUtc = fromZonedTime(`${row.slot_date}T${time}`, timezone)
    const startMs = startUtc.getTime()
    const iso = "yyyy-MM-dd'T'HH:mm:ssxxx"

    ;(result[row.slot_date] ??= []).push({
      startTime: formatInTimeZone(startMs, timezone, iso),
      endTime: formatInTimeZone(startMs + durationMins * 60 * 1000, timezone, iso),
      available: spotsOpen > 0,
      spotsOpen,
    })
  }

  for (const arr of Object.values(result)) {
    arr.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
  }
  return result
}

/**
 * A course's bookable slots for a single date, curated slots taking precedence
 * over GHL exactly as they do for the month view.
 *
 * The GHL half is cached per calendar+date: filtering the event list asks about
 * every bookable course at once, and without this each member browsing dates
 * would fan out a fresh call per course per keystroke.
 */
async function slotsForDate(admin: AdminClient, course: Course, date: string): Promise<GHLBookingSlot[]> {
  const timezone = course.timezone || AVIARA_TIMEZONE
  const durationMins = course.meeting_duration_mins || FALLBACK_ROUND_DURATION_MINUTES

  if (course.custom_slots_enabled) {
    const custom = await buildCustomSlots(admin, course.id, date, date, timezone, durationMins)
    // Only a curated date replaces GHL. An uncurated one falls through.
    if (custom[date]) return custom[date]
  }

  if (!course.ghl_calendar_id) return []

  const calendarId = course.ghl_calendar_id
  const cache = getCache(GHL_SLOTS_NS)
  const byDate = await withCache(
    cache,
    ghlSlotsKey(calendarId, date),
    () => getAvailableSlots({
      calendarId,
      startDate: date,
      endDate: date,
      timezone,
      userId: course.ghl_calendar_user_id || undefined,
      sendSeatsPerSlot: true,
      fallbackDurationMins: durationMins,
    }),
    GHL_SLOTS_TTL_MS,
  )

  return byDate[date] ?? []
}

/** Runs `fn` over `items` with at most `limit` in flight at once. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      const item = items[index]
      if (item === undefined) continue
      results[index] = await fn(item)
    }
  })

  await Promise.all(workers)
  return results
}

// ---- Aggregated month availability --------------------------
//
// The month calendar on /book answers "which venues can I play at, on which
// day" for every bookable course at once. GHL has no cross-calendar endpoint,
// so it costs one call per course per month — bounded by GHL_CONCURRENCY and
// cached per calendar+month, which is what keeps a second member opening the
// same month free.

/** A venue as the month calendar needs to label and colour it. */
export interface CalendarVenue {
  id: string
  name: string
  city: string | null
  state: string | null
}

/** One bookable tee time, as the calendar and its detail sheet quote it. */
export interface CalendarTee {
  /** Wall-clock 'HH:mm:ss' at the venue. */
  time: string
  /** Seats left at this tee time, never more than the day itself has left. */
  spotsOpen: number
}

/** One venue's opening on one day. */
export interface CalendarOpening {
  courseId: string
  /** Bookable tee times left that day — the true total, not tees.length. */
  openSlots: number
  /**
   * Seats bookable across those tee times, clamped to what the venue's daily
   * player cap still allows. Without the clamp a day could advertise more
   * seats than it can actually sell — the cap is enforced atomically at
   * booking time, so the surplus would fail with DAY_FULL on submit.
   */
  openSpots: number
  /**
   * The earliest few bookable tee times. Capped: the detail sheet previews
   * them, and the member picks an exact time in the booking flow itself, so
   * sending a whole day's grid per venue per day would bloat the month payload
   * for nothing.
   */
  tees: CalendarTee[]
}

// How many tee times per venue-day ride along in the month payload.
const TEE_PREVIEW_LIMIT = 4

export interface MonthAvailability {
  /** Every venue with at least one opening in the window, sorted by name. */
  venues: CalendarVenue[]
  /** 'YYYY-MM-DD' → the venues open that day. */
  days: Record<string, CalendarOpening[]>
}

/** A course's whole month of slots, curated dates overriding GHL as ever. */
async function slotsForMonth(
  admin: AdminClient,
  course: Course,
  month: string,
  startDate: string,
  endDate: string,
): Promise<Record<string, GHLBookingSlot[]>> {
  const timezone = course.timezone || AVIARA_TIMEZONE
  const durationMins = course.meeting_duration_mins || FALLBACK_ROUND_DURATION_MINUTES

  const ghl = course.ghl_calendar_id
    ? await withCache(
        getCache(GHL_SLOTS_NS),
        ghlSlotsMonthKey(course.ghl_calendar_id, month),
        () => getAvailableSlots({
          calendarId: course.ghl_calendar_id as string,
          startDate,
          endDate,
          timezone,
          userId: course.ghl_calendar_user_id || undefined,
          sendSeatsPerSlot: true,
          fallbackDurationMins: durationMins,
        }),
        GHL_SLOTS_TTL_MS,
      )
    : {}

  if (!course.custom_slots_enabled) return ghl

  // Only curated dates are replaced; the rest keep their GHL availability.
  const custom = await buildCustomSlots(admin, course.id, startDate, endDate, timezone, durationMins)
  return { ...ghl, ...custom }
}

/**
 * Every venue's openings across one month, keyed by day — what the aggregated
 * month calendar plots.
 *
 * A day is only listed for a venue if a member could actually book it: the
 * calendar has an open tee time AND the venue's daily player cap still has room.
 * Both checks mirror coursesWithAvailabilityOn, so the month grid and the
 * single-date filter can never disagree about whether a day is bookable.
 *
 * "Today" is resolved in each venue's own timezone — a tee time is wall-clock
 * local to the club, so a course an hour ahead drops today's date before one
 * behind it does.
 */
export async function venueAvailabilityForMonth(
  admin: AdminClient,
  courses: Course[],
  month: string,
  startDate: string,
  endDate: string,
): Promise<MonthAvailability> {
  if (courses.length === 0) return { venues: [], days: {} }

  // Seats already held per venue per day, in one query rather than one per
  // course-day.
  const { data: bookingRows } = await admin
    .from('bookings')
    .select('course_id, booking_date')
    .in('course_id', courses.map(c => c.id))
    .gte('booking_date', startDate)
    .lte('booking_date', endDate)
    .not('status', 'in', NON_HOLDING_STATUSES)

  const held = new Map<string, number>()
  for (const row of bookingRows ?? []) {
    const key = `${row.course_id}|${row.booking_date}`
    held.set(key, (held.get(key) ?? 0) + 1)
  }

  const perCourse = await mapWithConcurrency(courses, GHL_CONCURRENCY, async (course) => {
    // An unreachable calendar yields no slots rather than throwing, so one bad
    // venue drops out of the month instead of emptying it.
    const slots = await slotsForMonth(admin, course, month, startDate, endDate)
    const cap = course.max_players_per_day ?? DEFAULT_MAX_PLAYERS_PER_DAY
    const todayAtVenue = formatInTimeZone(new Date(), course.timezone || AVIARA_TIMEZONE, 'yyyy-MM-dd')

    const openings: Array<{ date: string; opening: CalendarOpening }> = []
    for (const [date, daySlots] of Object.entries(slots)) {
      if (date < todayAtVenue) continue

      // What the venue's daily cap still allows, whatever its calendar says.
      const dayRemaining = cap - (held.get(`${course.id}|${date}`) ?? 0)
      if (dayRemaining <= 0) continue

      const open = (daySlots ?? []).filter(s => s.available && (s.spotsOpen ?? 0) > 0)
      if (open.length === 0) continue

      openings.push({
        date,
        opening: {
          courseId: course.id,
          openSlots: open.length,
          openSpots: Math.min(
            open.reduce((n, s) => n + (s.spotsOpen ?? 0), 0),
            dayRemaining,
          ),
          // startTime carries the venue's own offset, so the wall-clock time is
          // readable straight off the string — no re-zoning on the client.
          tees: open
            .slice(0, TEE_PREVIEW_LIMIT)
            .map(s => ({
              time: s.startTime.split('T')[1]?.slice(0, 8) ?? '',
              // No single tee time can seat more than the day has left either.
              spotsOpen: Math.min(s.spotsOpen ?? 0, dayRemaining),
            }))
            .filter(t => t.time),
        },
      })
    }
    return { course, openings }
  })

  const days: Record<string, CalendarOpening[]> = {}
  const venues: CalendarVenue[] = []

  for (const { course, openings } of perCourse) {
    if (openings.length === 0) continue
    venues.push({ id: course.id, name: course.name, city: course.city, state: course.state })
    for (const { date, opening } of openings) {
      ;(days[date] ??= []).push(opening)
    }
  }

  venues.sort((a, b) => a.name.localeCompare(b.name))
  // Within a day, the venue teeing off earliest reads first — the same order the
  // grid chips and the agenda render in.
  for (const list of Object.values(days)) {
    list.sort((a, b) => (a.tees[0]?.time ?? '').localeCompare(b.tees[0]?.time ?? ''))
  }

  return { venues, days }
}

/**
 * Narrows `courses` to those a member could actually book on `date`.
 *
 * Two things can rule a course out, and both matter: its calendar may have
 * nothing open, or our own per-course daily cap may already be spent. The cap
 * is enforced atomically at booking time, so a course that passes only the
 * first check would list as available and then fail with DAY_FULL on submit.
 */
export async function coursesWithAvailabilityOn(
  admin: AdminClient,
  courses: Course[],
  date: string,
): Promise<Course[]> {
  if (courses.length === 0) return []

  // Seats already held at each course on this date, in one query rather than
  // one per course.
  const { data: bookingRows } = await admin
    .from('bookings')
    .select('course_id')
    .in('course_id', courses.map(c => c.id))
    .eq('booking_date', date)
    .not('status', 'in', NON_HOLDING_STATUSES)

  const heldByCourse = new Map<string, number>()
  for (const row of bookingRows ?? []) {
    const id = row.course_id as string
    heldByCourse.set(id, (heldByCourse.get(id) ?? 0) + 1)
  }

  const underDayCap = courses.filter(course => {
    const cap = course.max_players_per_day ?? DEFAULT_MAX_PLAYERS_PER_DAY
    return (heldByCourse.get(course.id) ?? 0) < cap
  })

  const open = await mapWithConcurrency(underDayCap, GHL_CONCURRENCY, async (course) => {
    // A calendar we can't reach returns no slots rather than throwing, so an
    // unreachable GHL hides the course from a date search instead of emptying
    // the whole list.
    const slots = await slotsForDate(admin, course, date)
    return hasOpenSlot(slots) ? course : null
  })

  return open.filter((c): c is Course => c !== null)
}
