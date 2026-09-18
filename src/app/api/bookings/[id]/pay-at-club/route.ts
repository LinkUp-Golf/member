export const dynamic = 'force-dynamic'

// POST /api/bookings/[id]/pay-at-club — the member will settle this round with
// the club on the day rather than through the venue's online checkout.
//
// Marks the row payment_method = 'pay_at_club'. The status is left where it is:
// nothing has been paid yet, and GHL still owns moving the round through its
// pipeline. What changes is that the round stops being "payment due" — it drops
// off the banner and no longer blocks the member from booking again (see
// findPendingPaymentBookings and create_bookings_for_day) — and it reads "Paid at
// club" wherever its status is shown.
//
// Only offered, and only accepted, at a venue whose payment_options include
// 'pay_at_club'.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { UNPAID_BOOKING_STATUSES } from '@/lib/bookings/pending-payment'
import { PAY_AT_CLUB, isPayAtClub, offersPayAtClub } from '@/lib/bookings/payment-options'
import { logger } from '@/lib/logger'
import type { AuthContext } from '@/lib/auth/types'

export const POST = withAuth(async (
  _req: NextRequest,
  ctx: AuthContext,
  routeCtx?: { params: Record<string, string> },
) => {
  const bookingId = routeCtx?.params?.['id']
  if (!bookingId) return NextResponse.json({ error: 'Missing booking id' }, { status: 400 })

  // Admin client so an invited player's row (member_id = the booker) isn't
  // hidden by RLS. Ownership is checked by hand below.
  const admin = createAdminClient()

  const { data: booking } = await admin
    .from('bookings')
    .select('id, member_id, player_member_id, status, booking_date, payment_method, course:courses!bookings_course_id_fkey(payment_options)')
    .eq('id', bookingId)
    .maybeSingle()

  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })

  // Whoever can press "Pay" can choose to pay at the club: the member's own row,
  // or a row on a booking they made — the same rule as paying with credit.
  const isMine = booking.member_id === ctx.memberId || booking.player_member_id === ctx.memberId
  if (!isMine) return NextResponse.json({ error: 'That booking isn\'t yours to pay for.' }, { status: 403 })

  // Already chosen — answer as if it had just been set, so a double tap is harmless.
  if (isPayAtClub(booking)) {
    return NextResponse.json({ ok: true, payment_method: PAY_AT_CLUB })
  }

  if (!UNPAID_BOOKING_STATUSES.includes(booking.status as typeof UNPAID_BOOKING_STATUSES[number])) {
    return NextResponse.json({ error: 'That round isn\'t awaiting payment right now.' }, { status: 409 })
  }

  const course = (Array.isArray(booking.course) ? booking.course[0] : booking.course) as
    { payment_options: string[] | null } | null
  if (!offersPayAtClub(course)) {
    return NextResponse.json({ error: 'This venue doesn\'t take payment at the club.' }, { status: 409 })
  }

  const { data: updated, error } = await admin
    .from('bookings')
    .update({ payment_method: PAY_AT_CLUB })
    .eq('id', booking.id)
    // Only from "owed through the app", so a GHL webhook landing a payment at
    // the same moment can't be overwritten into a pay-at-club round.
    .in('status', UNPAID_BOOKING_STATUSES)
    .is('payment_method', null)
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'That round isn\'t awaiting payment right now.' }, { status: 409 })
  }

  logger.info('Booking marked pay at club', {
    action: 'booking.pay_at_club',
    userId: ctx.userId,
    metadata: { booking_id: booking.id },
  })

  return NextResponse.json({ ok: true, payment_method: PAY_AT_CLUB })
})
