export const dynamic = 'force-dynamic'

// ============================================================
// Force a venue-day open inside the join-only window.
//
//   GET  /api/admin/courses/[id]/open-days
//        → { today, windowDays, days: [{ date, bookedSpots, openTeeTimes,
//            forcedOpen }] } for each day of the window, at the venue.
//
//   PUT  /api/admin/courses/[id]/open-days
//        body { date: 'YYYY-MM-DD', open: boolean }
//        → opens the day (open: true) or hands it back to the rule (false).
//
// Inside the window a day nobody has booked is closed to members (see
// @/lib/bookings/lead-time). An admin opening it here lifts that and nothing
// else: the calendar still has to have a tee time, and the daily cap still
// applies — which is why GET reports openTeeTimes, so the admin can see when
// opening a day would offer nothing.
// ============================================================

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { formatInTimeZone } from 'date-fns-tz'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { validateDate, validateUUID } from '@/lib/validation'
import { AVIARA_TIMEZONE } from '@/lib/constants'
import { loadForcedOpenDays, NON_HOLDING_STATUSES, slotsForDate } from '@/lib/bookings/availability'
import { isInsideJoinOnlyWindow, JOIN_ONLY_WINDOW_DAYS, openDayKey } from '@/lib/bookings/lead-time'
import type { AuthContext } from '@/lib/auth/types'
import type { Course } from '@/types'

function getParams(routeCtx?: { params: Record<string, string> }) {
  return routeCtx?.params?.['id']
}

/** 'YYYY-MM-DD' `n` calendar days after `date`, on UTC midnights like daysUntil. */
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function todayAt(course: Pick<Course, 'timezone'>): string {
  return formatInTimeZone(new Date(), course.timezone || AVIARA_TIMEZONE, 'yyyy-MM-dd')
}

export const GET = withAuth(
  async (_req: NextRequest, _ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = getParams(routeCtx)
    if (!id || !validateUUID(id, 'course id').valid) {
      return NextResponse.json({ error: 'Invalid course id' }, { status: 400 })
    }

    const admin = createAdminClient()
    const { data: course } = await admin.from('courses').select('*').eq('id', id).single()
    if (!course) return NextResponse.json({ error: 'Course not found' }, { status: 404 })

    const today = todayAt(course as Course)
    const dates = Array.from({ length: JOIN_ONLY_WINDOW_DAYS }, (_, i) => addDays(today, i))
    const last = dates[dates.length - 1] ?? today

    const [{ data: bookingRows }, forcedOpen, slotsByDate] = await Promise.all([
      admin
        .from('bookings')
        .select('booking_date')
        .eq('course_id', id)
        .gte('booking_date', today)
        .lte('booking_date', last)
        .not('status', 'in', NON_HOLDING_STATUSES),
      loadForcedOpenDays(admin, [id], today, last),
      Promise.all(dates.map(d => slotsForDate(admin, course as Course, d))),
    ])

    const held = new Map<string, number>()
    for (const row of bookingRows ?? []) {
      const d = row.booking_date as string
      held.set(d, (held.get(d) ?? 0) + 1)
    }

    const days = dates.map((date, i) => ({
      date,
      bookedSpots: held.get(date) ?? 0,
      openTeeTimes: (slotsByDate[i] ?? []).filter(s => s.available && (s.spotsOpen ?? 0) > 0).length,
      forcedOpen: forcedOpen.has(openDayKey(id, date)),
    }))

    return NextResponse.json({ today, windowDays: JOIN_ONLY_WINDOW_DAYS, days })
  },
  { requireAdmin: true, skipGHLCheck: true }
)

export const PUT = withAuth(
  async (req: NextRequest, ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = getParams(routeCtx)
    if (!id || !validateUUID(id, 'course id').valid) {
      return NextResponse.json({ error: 'Invalid course id' }, { status: 400 })
    }

    const body = await req.json().catch(() => null) as { date?: unknown; open?: unknown } | null
    const date = typeof body?.date === 'string' ? body.date : ''
    if (!validateDate(date, 'date').valid) {
      return NextResponse.json({ error: 'date required (YYYY-MM-DD)' }, { status: 400 })
    }
    if (typeof body?.open !== 'boolean') {
      return NextResponse.json({ error: 'open must be true or false' }, { status: 400 })
    }

    const admin = createAdminClient()
    const { data: course } = await admin.from('courses').select('id, timezone').eq('id', id).single()
    if (!course) return NextResponse.json({ error: 'Course not found' }, { status: 404 })

    if (!body.open) {
      // Closing is always allowed — it only hands the day back to the rule.
      const { error } = await admin
        .from('course_open_days')
        .delete()
        .eq('course_id', id)
        .eq('open_date', date)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ date, forcedOpen: false })
    }

    // Opening only means something inside the window: outside it the day is
    // open already, and a row written now would silently keep it open later
    // without anyone having decided that about the day as it is then.
    if (!isInsideJoinOnlyWindow(date, todayAt(course))) {
      return NextResponse.json(
        { error: `Only days within the next ${JOIN_ONLY_WINDOW_DAYS} days can be forced open — later days are open already.` },
        { status: 400 }
      )
    }

    const { error } = await admin
      .from('course_open_days')
      .upsert(
        { course_id: id, open_date: date, opened_by: ctx.memberId },
        { onConflict: 'course_id,open_date', ignoreDuplicates: true }
      )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    console.log('[admin/open-days] Forced open', { courseId: id, date, by: ctx.memberId })
    return NextResponse.json({ date, forcedOpen: true })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
