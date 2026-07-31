export const dynamic = 'force-dynamic'

// GET /api/surveys/pending — the caller's finished rounds that still need a
// satisfaction rating, plus any round finishing soon enough that the client can
// hold a live timer for it.
//
// Each entry carries its own `due_at`, so the client prompts at the moment the
// round actually ends rather than whenever a page happens to load.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import {
  surveyDueAt,
  surveyRecipientFilter,
  SURVEYABLE_BOOKING_STATUSES,
  SURVEY_LOOKAHEAD_HOURS,
} from '@/lib/surveys/due'
import type { AuthContext } from '@/lib/auth/types'

// How long an eligible round stays worth popping up about, for a member who
// wasn't in the app when it finished. Past this they won't remember it well
// enough for the answer to mean much, and a stack of modals on next open is
// its own problem — My Bookings still offers the round manually.
//
// This is a staleness bound, not the pre-existing-bookings rule: rounds that
// finished before the survey shipped are excluded outright by
// survey_auto_prompt, however recent they are.
const BACKLOG_DAYS = 14

const dayKey = (d: Date) => d.toISOString().slice(0, 10)

interface BookingRow {
  id: string
  booking_date: string
  tee_time: string
  course: {
    id: string
    name: string
    city: string | null
    timezone: string | null
    meeting_duration_mins: number | null
  } | null
}

export const GET = withAuth(async (_req: NextRequest, ctx: AuthContext) => {
  const admin = createAdminClient()
  const now = new Date()

  // Bound the scan by calendar date first — cheap, indexed, and a superset of
  // what the precise due_at check below will keep.
  const from = dayKey(new Date(now.getTime() - BACKLOG_DAYS * 24 * 60 * 60 * 1000))
  const to = dayKey(new Date(now.getTime() + 24 * 60 * 60 * 1000))

  const { data, error } = await admin
    .from('bookings')
    .select(
      'id, booking_date, tee_time, course:courses!bookings_course_id_fkey(id, name, city, timezone, meeting_duration_mins)',
    )
    // Rounds this member played — ones they booked for themselves, plus ones
    // another member booked with them as the player.
    .or(surveyRecipientFilter(ctx.memberId))
    // Rounds that had already finished when the survey shipped are never
    // popped up; they're rateable by hand from My Bookings instead.
    .eq('survey_auto_prompt', true)
    // 'cancelled' isn't in this list, so a cancelled round is never surveyed.
    .in('status', SURVEYABLE_BOOKING_STATUSES)
    .gte('booking_date', from)
    .lte('booking_date', to)
    .order('booking_date', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const bookings = (data ?? []) as unknown as BookingRow[]
  if (bookings.length === 0) return NextResponse.json({ surveys: [] })

  const { data: answered } = await admin
    .from('booking_surveys')
    .select('booking_id')
    .in('booking_id', bookings.map(b => b.id))

  const answeredIds = new Set((answered ?? []).map(r => r.booking_id))
  const horizon = now.getTime() + SURVEY_LOOKAHEAD_HOURS * 60 * 60 * 1000

  const surveys = bookings
    .filter(b => !answeredIds.has(b.id))
    .map(b => ({
      booking_id: b.id,
      booking_date: b.booking_date,
      tee_time: b.tee_time,
      course_name: b.course?.name ?? 'your round',
      course_city: b.course?.city ?? null,
      due_at: surveyDueAt(b, b.course).toISOString(),
    }))
    // Already askable, or askable soon enough to be worth a timer.
    .filter(s => new Date(s.due_at).getTime() <= horizon)
    // Oldest first: work through the backlog before asking about today's round.
    .sort((a, b) => a.due_at.localeCompare(b.due_at))

  return NextResponse.json({ surveys })
})
