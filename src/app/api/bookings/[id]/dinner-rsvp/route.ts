export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { withAuth } from '@/lib/auth/with-auth'
import { createRouteHandlerClient } from '@/lib/supabase-server'
import { sendPushToAdmins } from '@/lib/push'
import type { AuthContext } from '@/lib/auth/types'

const VALID_RSVP = new Set(['yes', 'no', 'maybe'])
const DINNER_STATUSES = new Set(['confirmed', 'availability_confirmed', 'payment_confirmed', 'tentative', 'awaiting_approval'])

export const PATCH = withAuth(async (
  req: NextRequest,
  ctx: AuthContext,
  routeCtx?: { params: Record<string, string> }
) => {
  const bookingId = routeCtx?.params?.['id']
  if (!bookingId) return NextResponse.json({ error: 'Missing booking id' }, { status: 400 })

  const body = await req.json() as { rsvp?: string }
  if (!body.rsvp || !VALID_RSVP.has(body.rsvp)) {
    return NextResponse.json({ error: 'rsvp must be yes, no, or maybe' }, { status: 400 })
  }

  const supabase = createRouteHandlerClient(cookies())

  // Verify the booking belongs to the current user and has an eligible status
  const { data: booking, error: fetchError } = await supabase
    .from('bookings')
    .select('id, status, booking_date, tee_time, member_id, player_member_id')
    .eq('id', bookingId)
    .single()

  if (fetchError || !booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  const ownsBooking = booking.member_id === ctx.userId || booking.player_member_id === ctx.userId
  if (!ownsBooking) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (!DINNER_STATUSES.has(booking.status)) {
    return NextResponse.json({ error: 'Dinner RSVP is not available for this booking' }, { status: 400 })
  }

  const { error } = await supabase
    .from('bookings')
    .update({ dinner_rsvp: body.rsvp })
    .eq('id', bookingId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Notify admins when response is "maybe" so they can follow up
  if (body.rsvp === 'maybe') {
    const dateStr = new Date(booking.booking_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    sendPushToAdmins({
      title: 'Dinner RSVP — maybe',
      body: `A member on the ${dateStr} booking is unsure about staying for dinner.`,
      url: '/admin/bookings',
      tag: `dinner-rsvp-${bookingId}`,
    }).catch(() => {})
  }

  return NextResponse.json({ success: true, dinner_rsvp: body.rsvp })
})
