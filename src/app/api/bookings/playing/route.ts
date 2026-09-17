export const dynamic = 'force-dynamic'

// GET /api/bookings/playing?month=YYYY-MM
//
// Who's playing where, for every day of a month — the members booked at each
// bookable venue, with their tee time. The aggregated calendar on /book puts
// their avatars on each day and lists them by venue and tee time on tap.
//
// Its own request rather than part of GET /api/bookings/availability: that one
// fans out to every venue's GHL calendar and is cached per calendar-month,
// while this is a single database read that should reflect a booking made a
// minute ago. The calendar shouldn't wait on one for the other.
//
// Only from yesterday (server time) onward — a day already gone is dimmed and
// closed on the calendar, and "who's playing" is a question about rounds still
// to come. Yesterday rather than today because the server runs in UTC: on a US
// evening UTC has already moved on, and the member's today would be cut off.
// The calendar decides which days are past for the member.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { addDays, format } from 'date-fns'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { loadPlayersForRange } from '@/lib/bookings/players'
import type { AuthContext } from '@/lib/auth/types'

export const GET = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  const month = req.nextUrl.searchParams.get('month')
  if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return NextResponse.json({ error: 'month parameter required (YYYY-MM)' }, { status: 400 })
  }

  const [yearStr, monthStr] = month.split('-')
  const year = parseInt(yearStr ?? '0', 10)
  const monthIdx = parseInt(monthStr ?? '1', 10) - 1
  const monthStart = format(new Date(year, monthIdx, 1), 'yyyy-MM-dd')
  const endDate = format(new Date(year, monthIdx + 1, 0), 'yyyy-MM-dd')
  const floor = format(addDays(new Date(), -1), 'yyyy-MM-dd')
  const startDate = monthStart > floor ? monthStart : floor

  const admin = createAdminClient()

  // The same venues the calendar plots (GET /api/bookings/availability), so a
  // day never shows players at a club it doesn't list.
  const { data: courses, error } = await admin
    .from('courses')
    .select('id')
    .eq('active', true)
    .eq('approval_status', 'active')
    .not('ghl_calendar_id', 'is', null)
    .not('payment_url', 'is', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const days = await loadPlayersForRange(admin, {
    courseIds: (courses ?? []).map((c) => c.id as string),
    startDate,
    endDate,
    selfId: ctx.memberId,
  })

  return NextResponse.json({ month, days })
}, { skipGHLCheck: true })
