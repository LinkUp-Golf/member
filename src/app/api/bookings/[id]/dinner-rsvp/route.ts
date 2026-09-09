export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { formatInTimeZone } from 'date-fns-tz'
import { sendPushToAdmins } from '@/lib/push'
import type { AuthContext } from '@/lib/auth/types'

const DINNER_STATUSES = new Set(['confirmed', 'availability_confirmed', 'payment_confirmed', 'tentative', 'awaiting_approval'])

export const PATCH = withAuth(async (
  req: NextRequest,
  ctx: AuthContext,
  routeCtx?: { params: Record<string, string> }
) => {
  const bookingId = routeCtx?.params?.['id']
  if (!bookingId) return NextResponse.json({ error: 'Missing booking id' }, { status: 400 })

  // One checkbox, so one boolean: true holds a seat at the group table, false
  // releases it. Anything else is a client that hasn't been updated.
  const body = await req.json() as { rsvp?: unknown }
  if (typeof body.rsvp !== 'boolean') {
    return NextResponse.json({ error: 'rsvp must be true or false' }, { status: 400 })
  }
  const rsvp = body.rsvp

  // Use admin client so invited-member rows (member_id = booker) aren't blocked by RLS.
  // Authorization is enforced manually via ownsBooking below.
  const admin = createAdminClient()

  const { data: booking, error: fetchError } = await admin
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

  const { error } = await admin
    .from('bookings')
    .update({ dinner_rsvp: rsvp })
    .eq('id', bookingId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Only a held seat is news — it's a headcount for the venue. Unchecking is
  // the default state and needs nobody's attention.
  // Push-only — this must never surface in the member announcement feed.
  if (rsvp) {
    // booking_date is a plain calendar date, not an instant — format in UTC
    // explicitly rather than relying on the server runtime's own timezone.
    const dateStr = formatInTimeZone(new Date(booking.booking_date), 'UTC', 'EEE, MMM d')

    const { data: responder } = await admin
      .from('members')
      .select('first_name, last_name')
      .eq('id', ctx.userId)
      .single()
    const memberName = responder ? `${responder.first_name} ${responder.last_name}` : 'A member'

    sendPushToAdmins({
      title: 'Dinner RSVP — yes',
      body: `${memberName} confirmed they're staying for dinner on ${dateStr}.`,
      url: '/admin/bookings',
      tag: `dinner-rsvp-${bookingId}`,
    }).catch(() => {})
  }

  return NextResponse.json({ success: true, dinner_rsvp: rsvp })
})
