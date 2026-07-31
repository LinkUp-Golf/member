export const dynamic = 'force-dynamic'

// POST /api/surveys — record the caller's satisfaction rating for one of their
// finished bookings.
//
// Everything the client could lie about is re-checked here: that the booking is
// theirs, that it reached a status worth surveying, that the round has actually
// finished, and that they haven't already answered.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { validateUUID } from '@/lib/validation'
import { isSurveyDue, surveyRecipientId, SURVEYABLE_BOOKING_STATUSES } from '@/lib/surveys/due'
import { logger } from '@/lib/logger'
import type { AuthContext } from '@/lib/auth/types'

const MAX_COMMENT = 1000

interface BookingRow {
  id: string
  member_id: string
  player_member_id: string | null
  course_id: string
  booking_date: string
  tee_time: string
  status: string
  course: { timezone: string | null; meeting_duration_mins: number | null } | null
}

export const POST = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  const body = (await req.json().catch(() => ({}))) as {
    booking_id?: unknown
    rating?: unknown
    attended?: unknown
    comment?: unknown
  }

  const idCheck = validateUUID(body.booking_id, 'booking_id')
  if (!idCheck.valid) {
    return NextResponse.json({ error: idCheck.errors[0] }, { status: 400 })
  }
  const bookingId = body.booking_id as string

  // The rating is the one required answer — a comment is optional, including
  // for a member who didn't make it.
  const rating = body.rating
  if (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: 'Choose a rating from 1 to 5 stars.' }, { status: 400 })
  }

  const attended = body.attended === undefined ? true : body.attended === true

  // Stored as the member typed it, only trimmed and capped. Deliberately not
  // run through sanitiseText: this is prose read back as a React text node
  // (the admin review table), so React escapes it at render — escaping again
  // on the way in would store "didn&#x27;t" and show it that way.
  let comment: string | null = null
  if (typeof body.comment === 'string' && body.comment.trim()) {
    if (body.comment.length > MAX_COMMENT) {
      return NextResponse.json({ error: 'Feedback is too long.' }, { status: 400 })
    }
    comment = body.comment.trim()
  }

  const admin = createAdminClient()

  const { data, error } = await admin
    .from('bookings')
    .select(
      'id, member_id, player_member_id, course_id, booking_date, tee_time, status, course:courses!bookings_course_id_fkey(timezone, meeting_duration_mins)',
    )
    .eq('id', bookingId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const booking = data as unknown as BookingRow | null

  // Only the member who played can rate the round — the booker when they
  // played it themselves, otherwise the named player. Same response whether
  // the booking doesn't exist or isn't theirs: don't confirm the existence of
  // another member's booking.
  if (!booking || surveyRecipientId(booking) !== ctx.memberId) {
    return NextResponse.json({ error: 'Booking not found.' }, { status: 404 })
  }

  if (!(SURVEYABLE_BOOKING_STATUSES as readonly string[]).includes(booking.status)) {
    return NextResponse.json({ error: 'This booking cannot be reviewed.' }, { status: 400 })
  }

  if (!isSurveyDue(booking, booking.course)) {
    return NextResponse.json({ error: 'This round has not finished yet.' }, { status: 400 })
  }

  const { error: insertError } = await admin.from('booking_surveys').insert({
    booking_id: booking.id,
    member_id: ctx.memberId,
    course_id: booking.course_id,
    rating,
    attended,
    comment,
  })

  if (insertError) {
    // booking_id is unique — a duplicate means the member already answered
    // (double submit, or a second tab). Treat it as done rather than an error.
    if (insertError.code === '23505') {
      return NextResponse.json({ ok: true, duplicate: true })
    }
    logger.error('Survey insert failed', {
      requestId: ctx.requestId,
      action: 'booking_survey_submit',
      metadata: { bookingId, error: insertError.message },
    })
    return NextResponse.json({ error: 'Could not save your response.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
})
