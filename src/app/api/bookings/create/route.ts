export const dynamic = 'force-dynamic'

// ============================================================
// POST /api/bookings/create
// Creates a booking in the Avi-Play GHL pipeline (Tentative stage).
// No payment is processed here — the existing GHL process handles
// availability confirmation and payment link delivery via email.
//
// Flow:
//   1. Validate member
//   2. Create GHL calendar event (decrements slot count on Aviara calendar)
//   3. Create Avi-Play pipeline opportunity at Tentative stage
//   4. Write one booking row per player to Supabase (status = 'tentative')
//   5. Post community announcement
//
// GET /api/bookings/create?date=YYYY-MM-DD
//   Returns available tee-time slots from the GHL Aviara calendar.
// ============================================================

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createRouteHandlerClient, createAdminClient } from '@/lib/supabase-server'
import { getAvailableSlots, getLocationTimezone } from '@/lib/ghl/client'
import { getCache } from '@/lib/cache'
import { COURSE_ANN_NS, courseAnnPrefix } from '@/lib/cache/keys'
import { format } from 'date-fns'

const BOOKING_PRICE = 160
const AVIARA_CALENDAR_ID = process.env.GHL_AVIARA_CALENDAR_ID ?? ''
const AVIARA_CALENDAR_USER_ID = process.env.GHL_AVIARA_CALENDAR_USER_ID ?? ''

// ============================================================
// GET /api/bookings/create?month=YYYY-MM&timezone=...
// Returns all available slots for the month, keyed by date.
// ============================================================
export async function GET(request: NextRequest) {
  const cookieStore = cookies()
  const supabase = createRouteHandlerClient(cookieStore)

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const month = searchParams.get('month')
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month parameter required (YYYY-MM)' }, { status: 400 })
  }

  // Client sends its own timezone; fall back to the GHL location timezone
  const clientTz = searchParams.get('timezone') ?? ''
  const timezone = clientTz || await getLocationTimezone(clientTz || undefined)

  const [yearStr, monthStr] = month.split('-')
  const year = parseInt(yearStr ?? '0', 10)
  const monthIdx = parseInt(monthStr ?? '1', 10) - 1
  const startDate = format(new Date(year, monthIdx, 1), 'yyyy-MM-dd')
  const endDate = format(new Date(year, monthIdx + 1, 0), 'yyyy-MM-dd')

  const slots = await getAvailableSlots({
    calendarId: AVIARA_CALENDAR_ID,
    startDate,
    endDate,
    timezone,
    userId: AVIARA_CALENDAR_USER_ID || undefined,
    sendSeatsPerSlot: true,
  })

  return NextResponse.json({ slots, timezone })
}

// ============================================================
// POST — create booking → GHL calendar event + Avi-Play opportunity
// ============================================================
export async function POST(request: NextRequest) {
  const cookieStore = cookies()
  const supabase = createRouteHandlerClient(cookieStore)

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch (e) {
    console.error('[booking/create] Failed to parse request body:', e)
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { date, teeTime, focusLinkupId, additionalPlayers } = body as {
    date: string
    teeTime: string
    focusLinkupId?: string
    additionalPlayers?: { firstName: string; lastName: string; mobile: string; email: string }[]
  }
  const extraPlayers = additionalPlayers ?? []

  console.log('[booking/create] Request:', { userId: user.id, date, teeTime, extraPlayers: extraPlayers.length })

  if (!date || !teeTime) {
    return NextResponse.json({ error: 'Date and tee time are required' }, { status: 400 })
  }

  const { data: member, error: memberError } = await supabase
    .from('members')
    .select('id, home_course_id, first_name, last_name')
    .eq('id', user.id)
    .single()

  if (memberError || !member) {
    console.error('[booking/create] Member lookup failed:', memberError)
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  console.log('[booking/create] Member found:', { memberId: member.id, courseId: member.home_course_id })

  const bookingDate = format(new Date(date), 'yyyy-MM-dd')
  const adminSupabase = createAdminClient()
  const memberName = `${member.first_name} ${member.last_name}`
  const totalPlayers = 1 + extraPlayers.length

  // Build one row for the primary member + one row per additional player
  const rows = [
    {
      member_id: user.id,
      course_id: member.home_course_id,
      booking_date: bookingDate,
      tee_time: teeTime,
      players: 1,
      guest_name: null as string | null,
      additional_players: [] as typeof extraPlayers,
      status: 'tentative',
      amount_charged: BOOKING_PRICE,
      focus_linkup_id: focusLinkupId ?? null,
    },
    ...extraPlayers.map(p => ({
      member_id: user.id,
      course_id: member.home_course_id,
      booking_date: bookingDate,
      tee_time: teeTime,
      players: 1,
      guest_name: [p.firstName, p.lastName].filter(Boolean).join(' ').trim() || p.email,
      additional_players: [p],
      status: 'tentative',
      amount_charged: BOOKING_PRICE,
      focus_linkup_id: focusLinkupId ?? null,
    })),
  ]

  console.log('[booking/create] Inserting', rows.length, 'booking row(s)')

  const { data: insertedBookings, error: insertError } = await adminSupabase
    .from('bookings')
    .insert(rows)
    .select('id')

  if (insertError || !insertedBookings?.length) {
    console.error('[booking/create] Booking insert failed:', insertError)
    return NextResponse.json(
      { error: 'Failed to create booking records', detail: insertError?.message },
      { status: 500 }
    )
  }

  console.log('[booking/create] Bookings created:', insertedBookings.map(b => b.id))

  const primaryBookingId = insertedBookings[0]?.id ?? ''

  // Post community announcement — non-fatal if it fails
  const playerSuffix = totalPlayers > 1 ? ` +${extraPlayers.length} guest${extraPlayers.length !== 1 ? 's' : ''}` : ''
  const { error: annError } = await adminSupabase
    .from('announcements')
    .insert({
      course_id: member.home_course_id,
      author_id: user.id,
      type: 'booking',
      title: `${memberName}${playerSuffix} is playing on ${format(new Date(date + 'T12:00:00'), 'EEEE, MMMM d')}`,
      body: `${member.first_name} has booked a tee time at ${teeTime.slice(0, 5)} on ${format(new Date(date + 'T12:00:00'), 'EEEE, MMMM d')}${totalPlayers > 1 ? ` for ${totalPlayers} players` : ''}. Want to join? Send them a message.`,
      metadata: {
        booking_id: primaryBookingId,
        booking_date: bookingDate,
        tee_time: teeTime,
        member_id: user.id,
      },
      status: 'published',
      published_at: new Date().toISOString(),
    })

  if (annError) {
    console.error('[booking/create] Announcement insert failed (non-fatal):', annError)
  }

  await getCache(COURSE_ANN_NS).clear(courseAnnPrefix(member.home_course_id)).catch((e) => {
    console.error('[booking/create] Cache clear failed (non-fatal):', e)
  })

  console.log('[booking/create] Success, primaryBookingId:', primaryBookingId)

  return NextResponse.json({
    bookingId: primaryBookingId,
    bookingIds: insertedBookings.map(b => b.id),
    message: 'Booking submitted. We will confirm availability and send your payment link by email.',
  })
}
