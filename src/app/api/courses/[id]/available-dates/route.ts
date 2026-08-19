export const dynamic = 'force-dynamic'

// GET /api/courses/[id]/available-dates?month=YYYY-MM
//
// The days a venue can actually take a round. Used wherever someone picks a
// venue and then a date for it — the host event form and the become-a-host
// application — so the answer is asked of the venue rather than typed in and
// found wrong at approval time.
//
// Availability comes from venueAvailabilityForMonth, the same helper behind the
// member booking calendar, so the two can't disagree about whether a day is
// open: a day counts only if the club's calendar has a tee time AND its daily
// player cap still has room, both resolved in the venue's own timezone.
//
// Member-scoped rather than host-scoped. The applicant filling in a host
// application isn't a host yet, and this is the same availability /book already
// shows every member — the rule about which venues a host may actually list at
// is enforced where events are created, not here.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { venueAvailabilityForMonth } from '@/lib/bookings/availability'
import { validateUUID } from '@/lib/validation'
import { format } from 'date-fns'
import type { AuthContext } from '@/lib/auth/types'
import type { Course } from '@/types'

export const GET = withAuth(async (
  req: NextRequest,
  _ctx: AuthContext,
  routeCtx?: { params?: { id?: string } },
) => {
  const courseId = routeCtx?.params?.id
  if (!courseId || !validateUUID(courseId, 'Venue').valid) {
    return NextResponse.json({ error: 'Venue required' }, { status: 400 })
  }

  const month = req.nextUrl.searchParams.get('month')
  if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return NextResponse.json({ error: 'month parameter required (YYYY-MM)' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: course } = await admin
    .from('courses')
    .select('*')
    .eq('id', courseId)
    .eq('active', true)
    .maybeSingle()

  if (!course) {
    return NextResponse.json({ error: 'That venue is not available.' }, { status: 404 })
  }

  // A club still waiting on its LinkUp setup has no calendar to read, which is a
  // different answer from "nothing is open" — the picker needs to say so rather
  // than show an empty month.
  if (!course.ghl_calendar_id) {
    return NextResponse.json({ month, dates: [], unconfigured: true })
  }

  const [yearStr, monthStr] = month.split('-')
  const year = parseInt(yearStr ?? '0', 10)
  const monthIdx = parseInt(monthStr ?? '1', 10) - 1
  const startDate = format(new Date(year, monthIdx, 1), 'yyyy-MM-dd')
  const endDate = format(new Date(year, monthIdx + 1, 0), 'yyyy-MM-dd')

  const { days } = await venueAvailabilityForMonth(
    admin,
    [course as Course],
    month,
    startDate,
    endDate,
  )

  // One entry per open day, ascending. The counts ride along so a picker can
  // show how much room a day has without a second call.
  const dates = Object.entries(days)
    .map(([date, openings]) => ({
      date,
      openSlots: openings[0]?.openSlots ?? 0,
      openSpots: openings[0]?.openSpots ?? 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))

  return NextResponse.json({ month, dates, unconfigured: false })
})
