import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Course, GHLBookingSlot } from '@/types'

vi.mock('@/lib/ghl/client', () => ({
  getAvailableSlots: vi.fn(),
}))

// The cache is exercised by cache.test.ts; here it would only let one case's
// slots leak into the next, so pass straight through to the fetcher.
vi.mock('@/lib/cache', () => ({
  getCache: () => ({}),
  withCache: <T,>(_c: unknown, _k: string, fetcher: () => Promise<T>) => fetcher(),
}))

import { getAvailableSlots } from '@/lib/ghl/client'
import {
  coursesWithAvailabilityOn,
  hasOpenSlot,
  normaliseTime,
  venueAvailabilityForMonth,
} from '@/lib/bookings/availability'

const mockedSlots = vi.mocked(getAvailableSlots)

// The date filter answers one question — "could I book here that day?" — and it
// has to answer it the same way the booking screen would. Two things can say no
// and both are load-bearing: an empty calendar, and our own per-course daily cap,
// which is enforced atomically at submit time. A course that passed only the
// calendar check would list as bookable and then fail with DAY_FULL.

const DATE = '2099-06-01'

function makeCourse(overrides: Partial<Course> = {}): Course {
  return {
    id: 'course-1',
    name: 'Aviara',
    timezone: 'America/Los_Angeles',
    ghl_calendar_id: 'cal-1',
    ghl_calendar_user_id: null,
    meeting_duration_mins: 300,
    max_players_per_day: 15,
    custom_slots_enabled: false,
    ...overrides,
  } as Course
}

function slot(spotsOpen: number): GHLBookingSlot {
  return {
    startTime: `${DATE}T07:00:00-07:00`,
    endTime: `${DATE}T12:00:00-07:00`,
    available: spotsOpen > 0,
    spotsOpen,
  }
}

type BookingRow = { course_id: string; booking_date: string; tee_time: string }
type CustomRow = { slot_date: string; tee_time: string; seats: number }

/**
 * Stand-in for the PostgREST builder: every filter returns the same thenable,
 * which resolves to whatever rows the table was seeded with.
 */
function fakeAdmin(tables: { bookings?: BookingRow[]; course_custom_slots?: CustomRow[] }) {
  const build = (rows: unknown[]) => {
    const chainable: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'in', 'gte', 'lte', 'not', 'order', 'limit']) {
      chainable[method] = () => chainable
    }
    chainable.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve, reject)
    return chainable
  }

  return {
    from: (table: string) =>
      build(tables[table as keyof typeof tables] ?? []),
  } as unknown as Parameters<typeof coursesWithAvailabilityOn>[0]
}

beforeEach(() => {
  mockedSlots.mockReset()
})

describe('normaliseTime', () => {
  it('pads a stored HH:MM to the HH:MM:SS Postgres returns', () => {
    expect(normaliseTime('7:05')).toBe('07:05:00')
    expect(normaliseTime('07:05:00')).toBe('07:05:00')
  })
})

describe('hasOpenSlot', () => {
  it('is true only when a slot has a seat left', () => {
    expect(hasOpenSlot([slot(2)])).toBe(true)
    expect(hasOpenSlot([slot(0)])).toBe(false)
    expect(hasOpenSlot([])).toBe(false)
    expect(hasOpenSlot(undefined)).toBe(false)
  })

  it('ignores a slot flagged available with no seats', () => {
    // available and spotsOpen disagree when a slot fills between GHL's read and
    // ours; the seat count is the one that decides.
    expect(hasOpenSlot([{ ...slot(0), available: true }])).toBe(false)
  })
})

describe('coursesWithAvailabilityOn', () => {
  it('keeps a course with an open tee time', async () => {
    mockedSlots.mockResolvedValue({ [DATE]: [slot(4)] })
    const result = await coursesWithAvailabilityOn(fakeAdmin({}), [makeCourse()], DATE)
    expect(result.map(c => c.id)).toEqual(['course-1'])
  })

  it('drops a course whose calendar has nothing open that day', async () => {
    mockedSlots.mockResolvedValue({ [DATE]: [slot(0)] })
    const result = await coursesWithAvailabilityOn(fakeAdmin({}), [makeCourse()], DATE)
    expect(result).toEqual([])
  })

  it('drops a course with no slots at all for the date', async () => {
    mockedSlots.mockResolvedValue({})
    const result = await coursesWithAvailabilityOn(fakeAdmin({}), [makeCourse()], DATE)
    expect(result).toEqual([])
  })

  it('drops a course already at its daily cap, even with slots open', async () => {
    // The cap is ours, not GHL's — GHL will happily keep offering tee times.
    mockedSlots.mockResolvedValue({ [DATE]: [slot(4)] })
    const admin = fakeAdmin({
      bookings: [
        { course_id: 'course-1', booking_date: DATE, tee_time: '07:00:00' },
        { course_id: 'course-1', booking_date: DATE, tee_time: '07:00:00' },
      ],
    })
    const result = await coursesWithAvailabilityOn(
      admin,
      [makeCourse({ max_players_per_day: 2 })],
      DATE,
    )
    expect(result).toEqual([])
    // Ruled out before we spend a GHL call on it.
    expect(mockedSlots).not.toHaveBeenCalled()
  })

  it('keeps a course still under its daily cap', async () => {
    mockedSlots.mockResolvedValue({ [DATE]: [slot(4)] })
    const admin = fakeAdmin({
      bookings: [{ course_id: 'course-1', booking_date: DATE, tee_time: '07:00:00' }],
    })
    const result = await coursesWithAvailabilityOn(
      admin,
      [makeCourse({ max_players_per_day: 2 })],
      DATE,
    )
    expect(result.map(c => c.id)).toEqual(['course-1'])
  })

  it('returns an empty list without querying anything when given no courses', async () => {
    const result = await coursesWithAvailabilityOn(fakeAdmin({}), [], DATE)
    expect(result).toEqual([])
    expect(mockedSlots).not.toHaveBeenCalled()
  })

  it('hides a course whose calendar is unreachable rather than emptying the list', async () => {
    // getAvailableSlots swallows GHL failures into {}, so an outage must not
    // take the other courses down with it.
    mockedSlots.mockImplementation(
      async ({ calendarId }): Promise<Record<string, GHLBookingSlot[]>> =>
        calendarId === 'cal-1' ? {} : { [DATE]: [slot(4)] },
    )
    const result = await coursesWithAvailabilityOn(
      fakeAdmin({}),
      [makeCourse(), makeCourse({ id: 'course-2', ghl_calendar_id: 'cal-2' })],
      DATE,
    )
    expect(result.map(c => c.id)).toEqual(['course-2'])
  })

  it('preserves the order the courses came in', async () => {
    // The list arrives sorted by sort_order then name; filtering must not reshuffle it.
    mockedSlots.mockResolvedValue({ [DATE]: [slot(4)] })
    const courses = [
      makeCourse({ id: 'a', ghl_calendar_id: 'cal-a' }),
      makeCourse({ id: 'b', ghl_calendar_id: 'cal-b' }),
      makeCourse({ id: 'c', ghl_calendar_id: 'cal-c' }),
    ]
    const result = await coursesWithAvailabilityOn(fakeAdmin({}), courses, DATE)
    expect(result.map(c => c.id)).toEqual(['a', 'b', 'c'])
  })

  it('skips a course with no calendar configured', async () => {
    const result = await coursesWithAvailabilityOn(
      fakeAdmin({}),
      [makeCourse({ ghl_calendar_id: null })],
      DATE,
    )
    expect(result).toEqual([])
    expect(mockedSlots).not.toHaveBeenCalled()
  })

  describe('curated (custom slot) courses', () => {
    it('uses the curated seats and never asks GHL on a curated date', async () => {
      mockedSlots.mockResolvedValue({ [DATE]: [slot(4)] })
      const admin = fakeAdmin({
        course_custom_slots: [{ slot_date: DATE, tee_time: '07:00', seats: 2 }],
        bookings: [
          { course_id: 'course-1', booking_date: DATE, tee_time: '07:00:00' },
          { course_id: 'course-1', booking_date: DATE, tee_time: '07:00:00' },
        ],
      })
      const result = await coursesWithAvailabilityOn(
        admin,
        [makeCourse({ custom_slots_enabled: true })],
        DATE,
      )
      // Both curated seats are taken, so the course is out — even though GHL
      // would have offered a slot. A curated date replaces GHL entirely.
      expect(result).toEqual([])
      expect(mockedSlots).not.toHaveBeenCalled()
    })

    it('keeps a curated date that still has a seat', async () => {
      const admin = fakeAdmin({
        course_custom_slots: [{ slot_date: DATE, tee_time: '07:00', seats: 2 }],
        bookings: [{ course_id: 'course-1', booking_date: DATE, tee_time: '07:00:00' }],
      })
      const result = await coursesWithAvailabilityOn(
        admin,
        [makeCourse({ custom_slots_enabled: true })],
        DATE,
      )
      expect(result.map(c => c.id)).toEqual(['course-1'])
      expect(mockedSlots).not.toHaveBeenCalled()
    })

    it('falls back to GHL on a date the course has not curated', async () => {
      mockedSlots.mockResolvedValue({ [DATE]: [slot(4)] })
      // Curated rows exist, but for a different day.
      const admin = fakeAdmin({
        course_custom_slots: [{ slot_date: '2099-07-01', tee_time: '07:00', seats: 2 }],
      })
      const result = await coursesWithAvailabilityOn(
        admin,
        [makeCourse({ custom_slots_enabled: true })],
        DATE,
      )
      expect(result.map(c => c.id)).toEqual(['course-1'])
      expect(mockedSlots).toHaveBeenCalledOnce()
    })
  })
})

// ---- The last few days: join a round, don't start one --------

// Inside the window a venue-day nobody has booked is closed, and one with
// anyone on it stays open. The rule itself is unit-tested in
// join-only-window.test.ts; these check that the two surfaces a member actually
// meets apply it — and that the host path, which must not, doesn't.
//
// Dates are computed from today in the venue's own timezone rather than written
// down, because the rule is relative to it. Arithmetic on UTC midnights so a
// daylight-saving boundary can't shift a day.
const VENUE_TZ = 'America/Los_Angeles'
const todayAtVenue = new Intl.DateTimeFormat('en-CA', {
  timeZone: VENUE_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date())
const plusDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

const SOON = plusDays(todayAtVenue, 1)
const LATER = plusDays(todayAtVenue, 10)
const MONTH = SOON.slice(0, 7)

const held = (date: string) => ({
  bookings: [{ course_id: 'course-1', booking_date: date, tee_time: '07:00:00' }],
})

describe('coursesWithAvailabilityOn — the join-only window', () => {
  it('drops a near day nobody has booked, however open the calendar is', async () => {
    mockedSlots.mockResolvedValue({ [SOON]: [slot(4)] })
    const result = await coursesWithAvailabilityOn(fakeAdmin({}), [makeCourse()], SOON)
    expect(result).toEqual([])
  })

  it('keeps it the moment one person is going', async () => {
    mockedSlots.mockResolvedValue({ [SOON]: [slot(4)] })
    const result = await coursesWithAvailabilityOn(fakeAdmin(held(SOON)), [makeCourse()], SOON)
    expect(result.map(c => c.id)).toEqual(['course-1'])
  })

  it('leaves a day past the window open with nobody on it', async () => {
    mockedSlots.mockResolvedValue({ [LATER]: [slot(4)] })
    const result = await coursesWithAvailabilityOn(fakeAdmin({}), [makeCourse()], LATER)
    expect(result.map(c => c.id)).toEqual(['course-1'])
  })
})

describe('venueAvailabilityForMonth — the join-only window', () => {
  const forMonth = (
    admin: Parameters<typeof venueAvailabilityForMonth>[0],
    options?: { joinOnlyWindowDays?: number },
  ) =>
    venueAvailabilityForMonth(
      admin,
      [makeCourse()],
      MONTH,
      `${MONTH}-01`,
      `${MONTH}-28`,
      options,
    )

  it('leaves a near day off the grid and keeps the far one', async () => {
    mockedSlots.mockResolvedValue({ [SOON]: [slot(4)], [LATER]: [slot(4)] })
    const { days } = await forMonth(fakeAdmin({}))
    expect(Object.keys(days)).toEqual([LATER])
  })

  it('puts the near day back once someone has booked it', async () => {
    mockedSlots.mockResolvedValue({ [SOON]: [slot(4)], [LATER]: [slot(4)] })
    const { days } = await forMonth(fakeAdmin(held(SOON)))
    expect(Object.keys(days).sort()).toEqual([SOON, LATER].sort())
  })

  it('is off for the host path, which creates the interest it would demand', async () => {
    // openSpotsByDate passes this. A host listing a round IS the venue being
    // asked in advance, and members reserve against hosted_event_registrations
    // rather than bookings, so there would never be a booking to satisfy it.
    mockedSlots.mockResolvedValue({ [SOON]: [slot(4)] })
    const { days } = await forMonth(fakeAdmin({}), { joinOnlyWindowDays: 0 })
    expect(Object.keys(days)).toEqual([SOON])
  })
})
