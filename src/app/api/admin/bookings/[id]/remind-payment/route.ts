export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { triggerPaymentReminderWebhook } from '@/lib/ghl/client'
import { logger } from '@/lib/logger'
import { format } from 'date-fns'
import type { AuthContext } from '@/lib/auth/types'
import type { AdditionalPlayer } from '@/types'

// POST /api/admin/bookings/[id]/remind-payment
// Nudges a player to pay for a booking row that's still unpaid (tentative or
// availability_confirmed) by firing a GHL inbound webhook — the GHL workflow
// composes and sends the actual message. This reliably reaches players who
// don't have an app account (non-member guests) or push permission, and
// payment is time-sensitive.
export const POST = withAuth(
  async (req: NextRequest, ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing booking id' }, { status: 400 })

    const admin = createAdminClient()

    const { data: booking, error } = await admin
      .from('bookings')
      .select('id, member_id, player_member_id, guest_name, additional_players, booking_date, tee_time, status, course:courses!bookings_course_id_fkey(name, payment_url)')
      .eq('id', id)
      .single()

    if (error || !booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
    if (booking.status !== 'tentative' && booking.status !== 'availability_confirmed') {
      return NextResponse.json({ error: 'Booking is not awaiting payment' }, { status: 400 })
    }

    // Resolve the player's name + email for the webhook. The GHL workflow
    // matches the target contact by email. Member rows (booker or invited
    // member) carry the member's email; a non-member guest uses the email
    // captured at booking time.
    let firstName = ''
    let email = ''

    if (booking.player_member_id) {
      const { data: member } = await admin.from('members').select('first_name, email').eq('id', booking.player_member_id).single()
      firstName = member?.first_name ?? ''
      email = member?.email ?? ''
    } else if (!booking.guest_name) {
      const { data: member } = await admin.from('members').select('first_name, email').eq('id', booking.member_id).single()
      firstName = member?.first_name ?? ''
      email = member?.email ?? ''
    } else {
      const guest = (booking.additional_players as AdditionalPlayer[] | null)?.[0]
      firstName = guest?.firstName ?? ''
      email = guest?.email ?? ''
    }

    if (!email) return NextResponse.json({ error: 'No contact email found for this player' }, { status: 400 })

    // eventTime formatted like "1:35 pm" per the GHL webhook payload contract.
    const eventTime = format(new Date(`${booking.booking_date}T${booking.tee_time}`), 'h:mm aaa')
    const course = booking.course as unknown as { name: string; payment_url: string | null } | null
    const eventLocation = course?.name ?? 'your course'
    // Every course/event requires a payment link (enforced when the course is
    // created — see /api/admin/courses), so this should always be present.
    const paymentLink = course?.payment_url ?? `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/book`
    const displayName = firstName.trim() || email.trim()
    const capitalizedName = displayName ? displayName.charAt(0).toUpperCase() + displayName.slice(1) : ''

    const sent = await triggerPaymentReminderWebhook({
      firstName: capitalizedName,
      eventTime,
      eventLocation,
      paymentLink,
      email,
    })
    if (!sent) return NextResponse.json({ error: 'Failed to send payment reminder' }, { status: 502 })

    logger.info('Admin sent payment reminder', {
      action: 'booking.payment_reminder_sent',
      userId: ctx.userId,
      metadata: { booking_id: id, email },
    })

    return NextResponse.json({ ok: true })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
