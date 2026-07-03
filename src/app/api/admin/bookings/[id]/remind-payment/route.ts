export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { sendSms, getContactByEmail } from '@/lib/ghl/client'
import { logger } from '@/lib/logger'
import { format } from 'date-fns'
import type { AuthContext } from '@/lib/auth/types'
import type { AdditionalPlayer } from '@/types'

// POST /api/admin/bookings/[id]/remind-payment
// Sends a one-off SMS (via GHL) nudging a player to pay for a booking row
// that's still awaiting payment. SMS instead of push because not every
// player has an app account (non-member guests) or has granted push
// permission, and payment is time-sensitive enough to need a channel that
// reliably reaches them.
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
    if (booking.status !== 'availability_confirmed') {
      return NextResponse.json({ error: 'Booking is not awaiting payment' }, { status: 400 })
    }

    // Resolve who to text and their name/email for the message greeting.
    // Member rows (booker or invited member) have a GHL contact from signup;
    // a non-member guest's contact was created when the admin set up their
    // booking, so it's looked up by the email captured at booking time.
    let contactId: string | null = null
    let firstName = ''
    let email = ''

    if (booking.player_member_id) {
      const { data: member } = await admin.from('members').select('ghl_contact_id, first_name, email').eq('id', booking.player_member_id).single()
      contactId = member?.ghl_contact_id ?? null
      firstName = member?.first_name ?? ''
      email = member?.email ?? ''
    } else if (!booking.guest_name) {
      const { data: member } = await admin.from('members').select('ghl_contact_id, first_name, email').eq('id', booking.member_id).single()
      contactId = member?.ghl_contact_id ?? null
      firstName = member?.first_name ?? ''
      email = member?.email ?? ''
    } else {
      const guest = (booking.additional_players as AdditionalPlayer[] | null)?.[0]
      firstName = guest?.firstName ?? ''
      email = guest?.email ?? ''
      if (guest?.email) {
        const contact = await getContactByEmail(guest.email)
        contactId = contact?.id ?? null
      }
    }

    if (!contactId) return NextResponse.json({ error: 'No phone contact found for this player' }, { status: 400 })

    const displayDate = format(new Date(`${booking.booking_date}T12:00:00`), 'EEEE, MMMM d')
    const displayTime = (booking.tee_time as string).slice(0, 5)
    const course = booking.course as unknown as { name: string; payment_url: string | null } | null
    const courseName = course?.name ?? 'your course'
    // Every course/event requires a payment link (enforced when the course is
    // created — see /api/admin/courses), so this should always be present.
    const paymentUrl = course?.payment_url ?? `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/book`
    const displayName = firstName.trim() || email.trim()
    const capitalizedName = displayName ? displayName.charAt(0).toUpperCase() + displayName.slice(1) : ''
    const greeting = capitalizedName ? `Hi ${capitalizedName}` : 'Hi'
    const message = `${greeting}, your tee time at ${courseName} on ${displayDate} at ${displayTime} is confirmed but payment hasn't been received yet. Please pay ASAP to keep your spot: ${paymentUrl}`

    const sent = await sendSms(contactId, message)
    if (!sent) return NextResponse.json({ error: 'Failed to send SMS' }, { status: 502 })

    logger.info('Admin sent payment reminder SMS', {
      action: 'booking.payment_reminder_sms_sent',
      userId: ctx.userId,
      metadata: { booking_id: id, contact_id: contactId },
    })

    return NextResponse.json({ ok: true })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
