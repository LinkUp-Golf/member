export const dynamic = 'force-dynamic'

// ============================================================
// Admin-curated tee-time slots for a custom course.
//
//   GET  /api/admin/courses/[id]/slots?date=YYYY-MM-DD
//        → { ghlSlots, savedSlots } for that single date. ghlSlots is
//          the live GHL calendar's tee times (the source of truth the
//          admin picks from); savedSlots is what's already curated.
//
//   PUT  /api/admin/courses/[id]/slots?date=YYYY-MM-DD
//        body { slots: [{ tee_time, seats, source }] }
//        → replaces ALL curated rows for (course, date) with the payload.
//
// Only meaningful for courses with custom_slots_enabled = true.
// ============================================================

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { getAvailableSlots, getCalendarBookingRules } from '@/lib/ghl/client'
import { validateDate, validateUUID } from '@/lib/validation'
import { AVIARA_TIMEZONE, FALLBACK_ROUND_DURATION_MINUTES } from '@/lib/constants'
import type { AuthContext } from '@/lib/auth/types'

// A sane upper bound on curated tee times per day, to reject absurd payloads.
const MAX_SLOTS_PER_DATE = 96
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

function getParams(routeCtx?: { params: Record<string, string> }) {
  return routeCtx?.params?.['id']
}

export const GET = withAuth(
  async (req: NextRequest, _ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = getParams(routeCtx)
    if (!id || !validateUUID(id, 'course id').valid) {
      return NextResponse.json({ error: 'Invalid course id' }, { status: 400 })
    }
    const date = new URL(req.url).searchParams.get('date')
    if (!date || !validateDate(date, 'date').valid) {
      return NextResponse.json({ error: 'date query param required (YYYY-MM-DD)' }, { status: 400 })
    }

    const admin = createAdminClient()
    const { data: course } = await admin
      .from('courses')
      .select('ghl_calendar_id, ghl_calendar_user_id, timezone, meeting_duration_mins')
      .eq('id', id)
      .single()
    if (!course) return NextResponse.json({ error: 'Course not found' }, { status: 404 })

    // GHL tee times for the single day (source of truth the admin curates from),
    // plus the calendar's per-slot capacity (appoinmentPerSlot) — the ceiling a
    // curated slot's seats may not exceed. null = unlimited / GHL unreachable.
    let ghlSlots: Awaited<ReturnType<typeof getAvailableSlots>>[string] = []
    let calendarSeats: number | null = null
    if (course.ghl_calendar_id) {
      const [map, rules] = await Promise.all([
        getAvailableSlots({
          calendarId: course.ghl_calendar_id,
          startDate: date,
          endDate: date,
          timezone: course.timezone || AVIARA_TIMEZONE,
          userId: course.ghl_calendar_user_id || undefined,
          sendSeatsPerSlot: true,
          fallbackDurationMins: course.meeting_duration_mins || FALLBACK_ROUND_DURATION_MINUTES,
        }),
        getCalendarBookingRules(course.ghl_calendar_id),
      ])
      ghlSlots = map[date] ?? []
      calendarSeats = rules?.seatsPerSlot ?? null
    }

    const { data: savedSlots } = await admin
      .from('course_custom_slots')
      .select('id, slot_date, tee_time, seats, source')
      .eq('course_id', id)
      .eq('slot_date', date)
      .order('tee_time', { ascending: true })

    // Players already booked per tee time on this date (active rows only), so
    // the editor can show counts and warn if seats are set below what's booked.
    const { data: bookingRows } = await admin
      .from('bookings')
      .select('tee_time')
      .eq('course_id', id)
      .eq('booking_date', date)
      .not('status', 'in', '(cancelled,waitlist)')

    const booked: Record<string, number> = {}
    for (const row of bookingRows ?? []) {
      const t = String(row.tee_time).slice(0, 5) // 'HH:MM:SS' → 'HH:mm'
      booked[t] = (booked[t] ?? 0) + 1
    }

    return NextResponse.json({ ghlSlots, savedSlots: savedSlots ?? [], booked, calendarSeats })
  },
  { requireAdmin: true, skipGHLCheck: true }
)

export const PUT = withAuth(
  async (req: NextRequest, _ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = getParams(routeCtx)
    if (!id || !validateUUID(id, 'course id').valid) {
      return NextResponse.json({ error: 'Invalid course id' }, { status: 400 })
    }
    const date = new URL(req.url).searchParams.get('date')
    if (!date || !validateDate(date, 'date').valid) {
      return NextResponse.json({ error: 'date query param required (YYYY-MM-DD)' }, { status: 400 })
    }

    const admin = createAdminClient()
    const { data: course } = await admin
      .from('courses')
      .select('custom_slots_enabled, ghl_calendar_id')
      .eq('id', id)
      .single()
    if (!course) return NextResponse.json({ error: 'Course not found' }, { status: 404 })
    if (!course.custom_slots_enabled) {
      return NextResponse.json({ error: 'Enable custom slots for this course first' }, { status: 400 })
    }

    const body = await req.json().catch(() => null) as { slots?: unknown } | null
    const rawSlots = Array.isArray(body?.slots) ? body.slots : null
    if (!rawSlots) {
      return NextResponse.json({ error: 'slots array required' }, { status: 400 })
    }
    if (rawSlots.length > MAX_SLOTS_PER_DATE) {
      return NextResponse.json({ error: `Too many slots (max ${MAX_SLOTS_PER_DATE})` }, { status: 400 })
    }

    // Bounds for each slot's seat count:
    //   • ceiling  = the GHL calendar's per-slot capacity (never oversell a slot
    //     beyond what the calendar allows). null = unlimited.
    //   • floor    = players already booked at that tee time + 1, so a slot can
    //     never be lowered into "already full/overbooked" (always leaves ≥ 1).
    // Both are validated here — the authoritative gate — regardless of the UI.
    const [calRules, { data: bookingRows }] = await Promise.all([
      course.ghl_calendar_id ? getCalendarBookingRules(course.ghl_calendar_id) : Promise.resolve(null),
      admin
        .from('bookings')
        .select('tee_time')
        .eq('course_id', id)
        .eq('booking_date', date)
        .not('status', 'in', '(cancelled,waitlist)'),
    ])
    const calendarSeats = calRules?.seatsPerSlot ?? null
    const bookedByTime: Record<string, number> = {}
    for (const row of bookingRows ?? []) {
      const t = String(row.tee_time).slice(0, 5)
      bookedByTime[t] = (bookedByTime[t] ?? 0) + 1
    }

    // Validate + de-duplicate by tee_time (last write wins for a repeated time).
    const byTime = new Map<string, { course_id: string; slot_date: string; tee_time: string; seats: number; source: string }>()
    for (const raw of rawSlots as Array<Record<string, unknown>>) {
      const teeTime = String(raw.tee_time ?? '')
      if (!TIME_RE.test(teeTime)) {
        return NextResponse.json({ error: `Invalid tee time "${teeTime}" (expected HH:mm)` }, { status: 400 })
      }
      const seats = Number(raw.seats)
      if (!Number.isInteger(seats) || seats < 1) {
        return NextResponse.json({ error: `Seats for ${teeTime} must be a whole number ≥ 1` }, { status: 400 })
      }
      if (calendarSeats != null && seats > calendarSeats) {
        return NextResponse.json({ error: `Seats for ${teeTime} can't exceed the calendar capacity of ${calendarSeats}.` }, { status: 400 })
      }
      const bookedHere = bookedByTime[teeTime] ?? 0
      // Floor is booked+1, but never above the calendar ceiling (degenerate case
      // where a slot is already at capacity — then only the ceiling is allowed).
      const floor = calendarSeats != null ? Math.min(bookedHere + 1, calendarSeats) : bookedHere + 1
      if (seats < floor) {
        return NextResponse.json({ error: `${bookedHere} already booked at ${teeTime} — seats must be at least ${floor}.` }, { status: 400 })
      }
      const source = raw.source === 'ghl' ? 'ghl' : 'custom'
      byTime.set(teeTime, { course_id: id, slot_date: date, tee_time: teeTime, seats, source })
    }

    // Replace the whole day's curation atomically enough for admin use: clear then
    // insert. A concurrent second admin editing the same date is not a concern here.
    const { error: delError } = await admin
      .from('course_custom_slots')
      .delete()
      .eq('course_id', id)
      .eq('slot_date', date)
    if (delError) return NextResponse.json({ error: delError.message }, { status: 500 })

    const rows = [...byTime.values()]
    if (rows.length === 0) {
      return NextResponse.json({ savedSlots: [] })
    }

    const { data: savedSlots, error: insError } = await admin
      .from('course_custom_slots')
      .insert(rows)
      .select('id, slot_date, tee_time, seats, source')
      .order('tee_time', { ascending: true })
    if (insError) return NextResponse.json({ error: insError.message }, { status: 500 })

    return NextResponse.json({ savedSlots: savedSlots ?? [] })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
