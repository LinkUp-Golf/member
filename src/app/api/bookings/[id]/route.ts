export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import type { SupabaseClient } from '@supabase/supabase-js'
import { withAuth } from '@/lib/auth/with-auth'
import { createRouteHandlerClient, createAdminClient } from '@/lib/supabase-server'
import { cancelBooking, updateOpportunityStage } from '@/lib/ghl/client'
import { logActivity } from '@/lib/activity/log'
import { deleteBookingEverywhere } from '@/lib/bookings/delete'
import { stripeEnabled } from '@/lib/stripe/client'
import { seatCancellationQuote } from '@/lib/cancellation/policy'
import {
  discardCancellationFee,
  invoiceCancellationFee,
  recordCancellationFee,
} from '@/lib/cancellation/fees'
import { AVIARA_TIMEZONE } from '@/lib/constants'
import type { AuthContext } from '@/lib/auth/types'
import type { CancellationFee } from '@/types'

const AVI_PLAY_CANCELLED_STAGE_ID = process.env.GHL_AVI_PLAY_CANCELLED_STAGE_ID ?? ''

// What a seat's cancellation fee is worked out from — see seatCancellationQuote.
const SEAT_COLUMNS =
  'course_id, booking_date, tee_time, status, invite_status, amount_charged, cancellation_policy_applies'

interface SeatForFee {
  id: string
  course_id: string
  booking_date: string
  tee_time: string | null
  status: string
  invite_status: string | null
  amount_charged: number | string | null
  cancellation_policy_applies: boolean | null
}

/**
 * Records what cancelling this seat now costs the member cancelling it, before
 * the seat is released — see @/lib/cancellation/fees for why that order. A seat
 * that's free to cancel records nothing and returns `fee: null`.
 */
async function recordSeatFee(
  admin: SupabaseClient,
  memberId: string,
  seat: SeatForFee,
): Promise<{ fee: CancellationFee | null } | { refusal: NextResponse }> {
  if (!stripeEnabled() || seat.cancellation_policy_applies !== true) return { fee: null }

  const { data: course } = await admin
    .from('courses')
    .select('name, timezone, cost_per_player')
    .eq('id', seat.course_id)
    .maybeSingle()

  const quote = seatCancellationQuote(seat, course, AVIARA_TIMEZONE)
  if (quote.amount <= 0) return { fee: null }

  const recorded = await recordCancellationFee(admin, {
    memberId,
    source: 'booking',
    bookingId: seat.id,
    courseId: seat.course_id,
    courseName: course?.name ?? null,
    eventDate: seat.booking_date,
    teeTime: seat.tee_time,
    quote,
  })
  if ('duplicate' in recorded) {
    return { refusal: NextResponse.json({ error: 'This booking is already being cancelled.' }, { status: 409 }) }
  }
  if ('error' in recorded) {
    return { refusal: NextResponse.json({ error: "Couldn't cancel this booking. Try again." }, { status: 500 }) }
  }
  return { fee: recorded.fee }
}

export const PATCH = withAuth(async (
  req: NextRequest,
  ctx: AuthContext,
  routeCtx?: { params: Record<string, string> }
) => {
  const supabase = createRouteHandlerClient(cookies())

  const id = routeCtx?.params?.['id']
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const body = await req.json().catch(() => ({})) as { cancellationReason?: string }
  const cancellationReason = body.cancellationReason?.trim() ?? null

  // Fetch booking — allow both the booker and the guest member to act on it
  const { data: booking, error: fetchError } = await supabase
    .from('bookings')
    .select(`id, member_id, ghl_booking_id, ghl_opportunity_id, ${SEAT_COLUMNS}`)
    .eq('id', id)
    .or(`member_id.eq.${ctx.userId},player_member_id.eq.${ctx.userId}`)
    .single()

  if (fetchError || !booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  if (booking.status === 'cancelled') {
    return NextResponse.json({ error: 'Booking is already cancelled' }, { status: 400 })
  }

  const adminSupabase = createAdminClient()

  const seatFee = await recordSeatFee(adminSupabase, ctx.memberId, booking)
  if ('refusal' in seatFee) return seatFee.refusal

  // Mark cancelled in Supabase first
  const { error: updateError } = await adminSupabase
    .from('bookings')
    .update({ status: 'cancelled', cancellation_reason: cancellationReason })
    .eq('id', id)

  if (updateError) {
    if (seatFee.fee) await discardCancellationFee(adminSupabase, seatFee.fee.id)
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  // Resolve GHL contact ID for the booking owner (best-effort)
  const { data: bookingMember } = await adminSupabase
    .from('members')
    .select('ghl_contact_id')
    .eq('id', booking.member_id)
    .single()

  // Best-effort: mark GHL appointment as cancelled and move opportunity to Cancelled stage
  if (booking.ghl_booking_id) {
    await cancelBooking(booking.ghl_booking_id, bookingMember?.ghl_contact_id ?? undefined).catch(() => {})
  }
  if (booking.ghl_opportunity_id && AVI_PLAY_CANCELLED_STAGE_ID) {
    await updateOpportunityStage(booking.ghl_opportunity_id, AVI_PLAY_CANCELLED_STAGE_ID, 'lost').catch(() => {})
  }

  const fee = seatFee.fee ? await invoiceCancellationFee(adminSupabase, seatFee.fee) : null

  void logActivity({
    memberId: ctx.memberId,
    action: 'booking_cancelled',
    courseId: ctx.homeCourseId,
    targetId: booking.id,
    path: '/book',
  })

  return NextResponse.json({ success: true, fee })
})

// DELETE /api/bookings/[id]
// A member cancelling a seat from My Bookings. The same removal as the admin's
// Delete — the row goes from LinkUp and its appointment from GHL — rather than
// the soft cancel above. Who may: the booker, for any seat on their booking
// (every row carries their member_id), and an invited member for their own.
//
// Inside the cancellation window it costs the member cancelling a share of the
// seat's price, invoiced to them — the response's `fee` says what, with the
// invoice's link (null when it was free).
export const DELETE = withAuth(async (
  _req: NextRequest,
  ctx: AuthContext,
  routeCtx?: { params: Record<string, string> }
) => {
  const supabase = createRouteHandlerClient(cookies())

  const id = routeCtx?.params?.['id']
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const { data: booking, error: fetchError } = await supabase
    .from('bookings')
    .select(`id, ghl_booking_id, ${SEAT_COLUMNS}`)
    .eq('id', id)
    .or(`member_id.eq.${ctx.userId},player_member_id.eq.${ctx.userId}`)
    .single()

  if (fetchError || !booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  const admin = createAdminClient()

  const seatFee = await recordSeatFee(admin, ctx.memberId, booking)
  if ('refusal' in seatFee) return seatFee.refusal

  const { error, ghlDeleted } = await deleteBookingEverywhere(booking)
  if (error) {
    if (seatFee.fee) await discardCancellationFee(admin, seatFee.fee.id)
    return NextResponse.json({ error: "Couldn't cancel this booking. Try again." }, { status: 500 })
  }

  const fee = seatFee.fee ? await invoiceCancellationFee(admin, seatFee.fee) : null

  void logActivity({
    memberId: ctx.memberId,
    action: 'booking_cancelled',
    courseId: ctx.homeCourseId,
    targetId: booking.id,
    path: '/book',
  })

  return NextResponse.json({ success: true, ghlDeleted, fee })
}, { allowGuests: true })
