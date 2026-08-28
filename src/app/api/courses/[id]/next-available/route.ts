export const dynamic = 'force-dynamic'

// GET /api/courses/[id]/next-available
//
// The soonest day this venue can take a booking, looking forward from today
// rather than within one month.
//
// The month endpoints answer "what is open in August". This answers "when can I
// play here at all", which is a different question the moment August has
// nothing — and the question the pinned-venue dock on /book is asking. A
// featured club with an empty month should point at the month it does have
// something in, not disappear until the member happens to page onto it.
//
// Deliberately its own request rather than part of GET /api/bookings/availability:
// the walk costs a GHL call per month it has to look at, and the calendar should
// paint without waiting on a venue that may have nothing for a year. The dock
// fills in when this lands.
//
// Member-scoped, like the availability it reads: this is the same open-day rule
// /book already shows every member, for a venue every member can book.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { nextOpeningForCourse } from '@/lib/bookings/availability'
import { validateUUID } from '@/lib/validation'
import type { AuthContext } from '@/lib/auth/types'
import type { Course } from '@/types'

export const GET = withAuth(async (
  _req: NextRequest,
  _ctx: AuthContext,
  routeCtx?: { params?: { id?: string } },
) => {
  const courseId = routeCtx?.params?.id
  if (!courseId || !validateUUID(courseId, 'Venue').valid) {
    return NextResponse.json({ error: 'Venue required' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Bookable only — the same gate GET /api/courses applies. A club still
  // waiting on its LinkUp setup has no answer to give, and `next: null` is the
  // honest one rather than a date nobody could act on.
  const { data: course } = await admin
    .from('courses')
    .select('*')
    .eq('id', courseId)
    .eq('active', true)
    .eq('approval_status', 'active')
    .maybeSingle()

  if (!course) {
    return NextResponse.json({ error: 'That venue is not available.' }, { status: 404 })
  }

  const next = await nextOpeningForCourse(admin, course as Course)

  return NextResponse.json({ next })
})
