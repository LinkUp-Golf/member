export const dynamic = 'force-dynamic'

// GET /api/bookings/availability?month=YYYY-MM
//
// One month of tee-time availability across EVERY bookable venue, keyed by day
// — what the aggregated month calendar on /book plots. The per-course month
// endpoint (GET /api/bookings/create) answers "what can I book here"; this one
// answers "where can I play at all", which is the question you have before
// you've picked a venue.
//
// It costs one GHL call per venue for the month, so the underlying slot fetch is
// cached per calendar+month and the fan-out is capped. The venue list matches
// GET /api/courses exactly — a course must have a calendar and a way to be paid
// to be bookable, so anything absent there is absent here too.
//
// It also answers who is running each venue, which the day's tee sheet puts at
// the head of every tee time. That belongs here rather than on the who's-playing
// endpoint: a host is a property of the venue, not of the day, and this request
// is already talking to each venue's calendar — which is where the answer is.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createRouteHandlerClient, createAdminClient } from '@/lib/supabase-server'
import { venueAvailabilityForMonth } from '@/lib/bookings/availability'
import { loadVenueHosts } from '@/lib/bookings/venue-hosts'
import { canTakePayment } from '@/lib/bookings/payment-options'
import { format } from 'date-fns'
import type { Course } from '@/types'

export async function GET(req: NextRequest) {
  const cookieStore = cookies()
  const supabase = createRouteHandlerClient(cookieStore)

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const month = req.nextUrl.searchParams.get('month')
  if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return NextResponse.json({ error: 'month parameter required (YYYY-MM)' }, { status: 400 })
  }

  const [yearStr, monthStr] = month.split('-')
  const year = parseInt(yearStr ?? '0', 10)
  const monthIdx = parseInt(monthStr ?? '1', 10) - 1
  const startDate = format(new Date(year, monthIdx, 1), 'yyyy-MM-dd')
  const endDate = format(new Date(year, monthIdx + 1, 0), 'yyyy-MM-dd')

  const admin = createAdminClient()

  const { data: courses, error } = await admin
    .from('courses')
    .select('*')
    .eq('active', true)
    .eq('approval_status', 'active')
    .not('ghl_calendar_id', 'is', null)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Same payable rule as GET /api/courses, and for the same reason it isn't a
  // SQL filter there — see the note on that route.
  const payable = ((courses ?? []) as Course[]).filter(canTakePayment)

  // In parallel: the two halves ask GHL about the same calendars and neither
  // needs the other's answer.
  const [availability, hosts] = await Promise.all([
    venueAvailabilityForMonth(admin, payable, month, startDate, endDate),
    loadVenueHosts(admin, payable),
  ])

  return NextResponse.json({ month, ...availability, hosts })
}
