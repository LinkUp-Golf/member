export const dynamic = 'force-dynamic'

// GET /api/host/bookings — active upcoming bookings across the community that a
// host can take on and run as a hosted event. This is deliberately NOT limited
// to the caller's own bookings: a host handles existing tee times, whoever
// booked them.
//
// Seats: each seat in a booking is its own bookings row (see
// create_bookings_for_day), and a "group" is the rows sharing
// member + created_at + booking_date + tee_time + course. So the group's row
// count is the number of seats that booking holds — the ceiling on how many
// spots the hosted event may offer.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withHostAuth, type HostAuthContext } from '@/lib/auth/with-host-auth'
import { createAdminClient } from '@/lib/supabase-server'
import type { HostBookingOption } from '@/types'

// Cancelled / waitlisted rows don't hold a seat; every other status does —
// the same rule the capacity RPCs use.
const ACTIVE_STATUSES = [
  'tentative', 'awaiting_approval', 'availability_confirmed',
  'payment_confirmed', 'confirmed', 'pending',
]

const todayISO = () => new Date().toISOString().slice(0, 10)

// This reads bookings community-wide, so it has to stay bounded: a horizon on
// how far ahead we look, and a row cap. Rows are per-seat, so the cap is
// roughly a quarter of that many distinct bookings.
const HORIZON_DAYS = 90
const MAX_ROWS = 600

const horizonISO = () => {
  const d = new Date()
  d.setDate(d.getDate() + HORIZON_DAYS)
  return d.toISOString().slice(0, 10)
}

interface BookingRow {
  id: string
  member_id: string
  course_id: string
  booking_date: string
  tee_time: string
  created_at: string
  course: { name: string } | { name: string }[] | null
  member: { first_name: string; last_name: string } | { first_name: string; last_name: string }[] | null
}

export const GET = withHostAuth(async (_req: NextRequest, _ctx: HostAuthContext) => {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('bookings')
    .select('id, member_id, course_id, booking_date, tee_time, created_at, course:courses(name), member:members(first_name, last_name)')
    .gte('booking_date', todayISO())
    .lte('booking_date', horizonISO())
    .in('status', ACTIVE_STATUSES)
    .order('booking_date', { ascending: true })
    .limit(MAX_ROWS)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Collapse per-seat rows into one option per booking group. member_id is part
  // of the key now that bookings from different members are in play.
  const groups = new Map<string, { rows: BookingRow[]; row: BookingRow }>()
  for (const row of (data ?? []) as BookingRow[]) {
    const key = `${row.member_id}|${row.created_at}|${row.booking_date}|${row.tee_time}|${row.course_id}`
    const existing = groups.get(key)
    if (existing) existing.rows.push(row)
    else groups.set(key, { rows: [row], row })
  }

  // Which of these are already listed as a live hosted event (the partial
  // unique index enforces this too, but the UI should say so up front).
  const repIds = [...groups.values()].map(g => g.row.id)
  const listed = new Set<string>()
  if (repIds.length) {
    const { data: existing } = await admin
      .from('hosted_events')
      .select('source_booking_id')
      .in('source_booking_id', repIds)
      .neq('status', 'cancelled')
    for (const e of existing ?? []) {
      if (e.source_booking_id) listed.add(e.source_booking_id)
    }
  }

  const bookings: HostBookingOption[] = [...groups.values()].map(({ rows, row }) => {
    const course = Array.isArray(row.course) ? row.course[0] : row.course
    const member = Array.isArray(row.member) ? row.member[0] : row.member
    return {
      id: row.id,
      course_id: row.course_id,
      course_name: course?.name ?? null,
      booked_by: member ? `${member.first_name} ${member.last_name}`.trim() : null,
      booking_date: row.booking_date,
      tee_time: String(row.tee_time).slice(0, 5),
      seats: rows.length,
      already_listed: listed.has(row.id),
    }
  })

  return NextResponse.json({ bookings })
})
