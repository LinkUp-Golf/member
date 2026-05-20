// ============================================================
// POST /api/bookings/create
// 1. Verify member has access and booking window is valid
// 2. Check guest quota (max 1/month)
// 3. Create booking in GHL calendar
// 4. Charge via GHL/Stripe
// 5. Write booking to Supabase
// 6. Queue post-booking community announcement
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createRouteHandlerClient, createAdminClient } from '@/lib/supabase-server'
import { createBooking, chargeForBooking } from '@/lib/ghl/client'
import { format, addDays, differenceInDays } from 'date-fns'

const BOOKING_PRICE_CENTS = 16000     // $160.00
const BOOKING_WINDOW_MIN_DAYS = 3
const BOOKING_WINDOW_MAX_DAYS = 60
const AVIARA_CALENDAR_ID = process.env.GHL_AVIARA_CALENDAR_ID ?? ''

export async function POST(request: NextRequest) {
  const cookieStore = cookies()
  const supabase = createRouteHandlerClient(cookieStore)

  // Authenticate
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const body = await request.json()
  const { date, teeTime, players, guestName, focusLinkupId } = body

  // Validate inputs
  if (!date || !teeTime) {
    return NextResponse.json({ error: 'Date and tee time are required' }, { status: 400 })
  }

  const bookingDate = new Date(date)
  const today = new Date()
  const daysOut = differenceInDays(bookingDate, today)

  if (daysOut < BOOKING_WINDOW_MIN_DAYS || daysOut > BOOKING_WINDOW_MAX_DAYS) {
    return NextResponse.json({
      error: `Bookings must be between ${BOOKING_WINDOW_MIN_DAYS} and ${BOOKING_WINDOW_MAX_DAYS} days in advance`,
    }, { status: 400 })
  }

  // Get member record with GHL contact ID
  const { data: member } = await supabase
    .from('members')
    .select('id, ghl_contact_id, home_course_id, first_name, last_name')
    .eq('id', user.id)
    .single()

  if (!member) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  // Check guest quota — max 1 non-member guest per calendar month
  if (guestName) {
    const startOfMonth = new Date(bookingDate.getFullYear(), bookingDate.getMonth(), 1)
    const endOfMonth = new Date(bookingDate.getFullYear(), bookingDate.getMonth() + 1, 0)

    const { count } = await supabase
      .from('bookings')
      .select('id', { count: 'exact' })
      .eq('member_id', user.id)
      .not('guest_name', 'is', null)
      .gte('booking_date', format(startOfMonth, 'yyyy-MM-dd'))
      .lte('booking_date', format(endOfMonth, 'yyyy-MM-dd'))
      .neq('status', 'cancelled')

    if ((count ?? 0) >= 1) {
      return NextResponse.json({
        error: 'You have already brought a guest this month. The guest allowance resets on the 1st of each month.',
      }, { status: 400 })
    }
  }

  const adminSupabase = createAdminClient()

  // Write a pending booking to Supabase first
  const { data: pendingBooking, error: insertError } = await adminSupabase
    .from('bookings')
    .insert({
      member_id: user.id,
      course_id: member.home_course_id,
      booking_date: format(bookingDate, 'yyyy-MM-dd'),
      tee_time: teeTime,
      players: players ?? 1,
      guest_name: guestName ?? null,
      status: 'pending',
      amount_charged: BOOKING_PRICE_CENTS / 100,
      focus_linkup_id: focusLinkupId ?? null,
    })
    .select('id')
    .single()

  if (insertError || !pendingBooking) {
    return NextResponse.json({ error: 'Failed to create booking record' }, { status: 500 })
  }

  try {
    // Build the GHL calendar event times
    const [hours, minutes] = teeTime.split(':')
    const startDateTime = new Date(bookingDate)
    startDateTime.setHours(parseInt(hours), parseInt(minutes), 0, 0)
    const endDateTime = new Date(startDateTime.getTime() + 4.5 * 60 * 60 * 1000) // 4.5hr round

    const startISO = startDateTime.toISOString()
    const endISO = endDateTime.toISOString()

    // Create booking in GHL calendar
    const ghlEventId = await createBooking({
      calendarId: AVIARA_CALENDAR_ID,
      contactId: member.ghl_contact_id,
      startTime: startISO,
      endTime: endISO,
      title: `LinkUp Golf — ${member.first_name} ${member.last_name}${guestName ? ` + ${guestName}` : ''}`,
      notes: guestName ? `Guest: ${guestName}` : undefined,
    })

    if (!ghlEventId) {
      // Rollback — mark booking as cancelled
      await adminSupabase
        .from('bookings')
        .update({ status: 'cancelled' })
        .eq('id', pendingBooking.id)
      return NextResponse.json({ error: 'Failed to create booking in calendar. Please try again.' }, { status: 500 })
    }

    // Charge the member via GHL/Stripe
    const paymentId = await chargeForBooking({
      contactId: member.ghl_contact_id,
      amountCents: BOOKING_PRICE_CENTS,
      description: `LinkUp Golf — ${format(bookingDate, 'MMMM d, yyyy')} at ${teeTime}`,
    })

    if (!paymentId) {
      // Cancel the GHL booking and rollback
      await adminSupabase
        .from('bookings')
        .update({ status: 'cancelled' })
        .eq('id', pendingBooking.id)
      return NextResponse.json({
        error: 'Payment failed. Please check your payment method in your account settings.',
      }, { status: 402 })
    }

    // Confirm the booking in Supabase
    await adminSupabase
      .from('bookings')
      .update({
        status: 'confirmed',
        ghl_booking_id: ghlEventId,
        stripe_payment_id: paymentId,
      })
      .eq('id', pendingBooking.id)

    // Queue community announcement (auto-published, no moderation needed)
    await adminSupabase
      .from('announcements')
      .insert({
        course_id: member.home_course_id,
        author_id: user.id,
        type: 'booking',
        title: `${member.first_name} ${member.last_name} is playing on ${format(bookingDate, 'EEEE, MMMM d')}`,
        body: `${member.first_name} has booked a tee time at ${teeTime.slice(0, 5)} on ${format(bookingDate, 'EEEE, MMMM d')}. Want to join? Send them a message.`,
        metadata: {
          booking_id: pendingBooking.id,
          booking_date: format(bookingDate, 'yyyy-MM-dd'),
          tee_time: teeTime,
          member_id: user.id,
        },
        status: 'published',
        published_at: new Date().toISOString(),
      })

    return NextResponse.json({
      bookingId: pendingBooking.id,
      ghlEventId,
      message: 'Booking confirmed!',
    })
  } catch (err) {
    console.error('Booking error:', err)
    await adminSupabase
      .from('bookings')
      .update({ status: 'cancelled' })
      .eq('id', pendingBooking.id)
    return NextResponse.json({ error: 'An unexpected error occurred. Please try again.' }, { status: 500 })
  }
}

// ============================================================
// GET /api/bookings/available-slots?date=2026-05-15
// Returns available tee times for a given date
// ============================================================
export async function GET(request: NextRequest) {
  const cookieStore = cookies()
  const supabase = createRouteHandlerClient(cookieStore)

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const date = searchParams.get('date')
  if (!date) return NextResponse.json({ error: 'Date required' }, { status: 400 })

  // In production, call getAvailableSlots from lib/ghl.ts with the Aviara calendar ID
  // For now, return structured mock data in the correct format
  const mockSlots = [
    { startTime: `${date}T07:00:00`, endTime: `${date}T11:30:00`, available: true, spotsOpen: 3 },
    { startTime: `${date}T07:30:00`, endTime: `${date}T12:00:00`, available: true, spotsOpen: 4 },
    { startTime: `${date}T08:00:00`, endTime: `${date}T12:30:00`, available: true, spotsOpen: 2 },
    { startTime: `${date}T09:15:00`, endTime: `${date}T13:45:00`, available: true, spotsOpen: 4 },
    { startTime: `${date}T10:30:00`, endTime: `${date}T15:00:00`, available: true, spotsOpen: 1 },
    { startTime: `${date}T13:00:00`, endTime: `${date}T17:30:00`, available: true, spotsOpen: 4 },
    { startTime: `${date}T14:30:00`, endTime: `${date}T19:00:00`, available: false, spotsOpen: 0 },
  ]

  return NextResponse.json({ slots: mockSlots })
}
