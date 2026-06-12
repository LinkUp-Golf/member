export const dynamic = 'force-dynamic'

// ============================================================
// POST /api/bookings/create
// Creates a GHL calendar appointment then writes one Supabase
// booking row per player. GHL's booking pipeline handles
// opportunity creation automatically after the appointment.
//
// Flow:
//   1. Validate member
//   2. Create GHL calendar appointment
//   3. Write one booking row per player to Supabase (status = 'tentative')
//   4. Post community announcement
//
// GET /api/bookings/create?month=YYYY-MM&timezone=...
//   Returns available tee-time slots from the GHL Aviara calendar.
// ============================================================

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createRouteHandlerClient, createAdminClient } from '@/lib/supabase-server'
import { getAvailableSlots, createBooking, getContactByEmail, createContact } from '@/lib/ghl/client'
import { getCache } from '@/lib/cache'
import { COURSE_ANN_NS, courseAnnPrefix } from '@/lib/cache/keys'
import { format } from 'date-fns'
import {
  BOOKING_PRICE_USD,
  AVIARA_TIMEZONE,
  AVIARA_ADDRESS,
  GOLF_ROUND_DURATION_MINUTES,
} from '@/lib/constants'

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

  // Client sends its own timezone; fall back to Aviara timezone
  const clientTz = searchParams.get('timezone') ?? ''
  const timezone = clientTz || AVIARA_TIMEZONE

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
// POST — create GHL appointment then Supabase booking rows
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

  const { startTime: slotStartTime, focusLinkupId, additionalPlayers } = body as {
    startTime: string
    focusLinkupId?: string
    additionalPlayers?: { firstName: string; lastName: string; mobile: string; email: string; memberId?: string }[]
  }
  const extraPlayers = additionalPlayers ?? []

  if (!slotStartTime) {
    return NextResponse.json({ error: 'startTime is required' }, { status: 400 })
  }

  console.log('[booking/create] Request:', { userId: user.id, slotStartTime, extraPlayers: extraPlayers.length })

  // Convert slot ISO datetime to date + time in AVIARA_TIMEZONE, regardless of the
  // timezone the client used when fetching slots.
  const slotMoment = new Date(slotStartTime)
  if (isNaN(slotMoment.getTime())) {
    return NextResponse.json({ error: 'Invalid startTime value' }, { status: 400 })
  }
  const localParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: AVIARA_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(slotMoment)
  const lp = (type: string) => localParts.find(p => p.type === type)?.value ?? '00'
  const bookingDate = `${lp('year')}-${lp('month')}-${lp('day')}`
  const timeNormalized = `${lp('hour')}:${lp('minute')}:${lp('second')}`

  console.log('[booking/create] Resolved in AVIARA_TIMEZONE:', { bookingDate, timeNormalized })

  const { data: member, error: memberError } = await supabase
    .from('members')
    .select('id, home_course_id, first_name, last_name, email, phone, ghl_contact_id')
    .eq('id', user.id)
    .single()

  if (memberError || !member) {
    console.error('[booking/create] Member lookup failed:', memberError)
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  console.log('[booking/create] Member found:', { memberId: member.id, courseId: member.home_course_id })

  const adminSupabase = createAdminClient()
  const memberName = `${member.first_name} ${member.last_name}`
  const totalPlayers = 1 + extraPlayers.length

  // Build start/end ISO strings with AVIARA_TIMEZONE offset — format: "YYYY-MM-DDTHH:MM:SS±HHMM"
  const noonUtc = new Date(`${bookingDate}T12:00:00Z`)
  const offsetRaw = new Intl.DateTimeFormat('en-US', { timeZone: AVIARA_TIMEZONE, timeZoneName: 'shortOffset' })
    .formatToParts(noonUtc)
    .find(p => p.type === 'timeZoneName')?.value ?? 'GMT+0'
  const offsetMatch = offsetRaw.match(/GMT([+-])(\d+)(?::(\d+))?/)
  const tzOffset = offsetMatch
    ? `${offsetMatch[1]}${(offsetMatch[2] ?? '0').padStart(2, '0')}${(offsetMatch[3] ?? '0').padStart(2, '0')}`
    : '+0000'
  const startIso = `${bookingDate}T${timeNormalized}${tzOffset}`
  const [th, tm] = timeNormalized.split(':').map(Number)
  const endMinutes = (th ?? 0) * 60 + (tm ?? 0) + GOLF_ROUND_DURATION_MINUTES
  const endIso = `${bookingDate}T${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}:00${tzOffset}`

  const bookingParams = {
    calendarId: AVIARA_CALENDAR_ID,
    title: 'LinkUp @ Aviara',
    startTime: startIso,
    endTime: endIso,
    timezone: AVIARA_TIMEZONE,
    address: AVIARA_ADDRESS,
  }

  // Step 1: Create GHL appointment for the primary booker — must succeed
  let primaryGhlId: string
  try {
    primaryGhlId = await createBooking({
      ...bookingParams,
      contact: {
        id: member.ghl_contact_id,
        email: member.email,
        phone: member.phone ?? null,
      },
    })
  } catch (err) {
    console.error('[booking/create] GHL appointment creation failed:', String(err))
    return NextResponse.json(
      { error: 'Failed to create appointment in GHL. Please try again.', detail: String(err) },
      { status: 502 }
    )
  }

  console.log('[booking/create] GHL appointment created for primary:', primaryGhlId)

  // Step 1b: Create GHL appointments for each guest in parallel (non-fatal)
  const guestGhlIds = await Promise.all(
    extraPlayers.map(async (p) => {
      try {
        const existing = await getContactByEmail(p.email)
        const contactId = existing?.id ?? await createContact({
          firstName: p.firstName,
          lastName: p.lastName,
          email: p.email,
          phone: p.mobile || null,
        })
        if (!contactId) return null
        const ghlId = await createBooking({
          ...bookingParams,
          contact: { id: contactId, email: p.email, phone: p.mobile || null },
        })
        console.log('[booking/create] GHL appointment created for guest:', p.email, ghlId)
        return ghlId
      } catch (err) {
        console.warn('[booking/create] Guest GHL appointment failed (non-fatal):', p.email, String(err))
        return null
      }
    })
  )

  // Step 2: Supabase insert — one row per player
  const rows = [
    {
      member_id: user.id,
      course_id: member.home_course_id,
      booking_date: bookingDate,
      tee_time: timeNormalized,
      players: 1,
      guest_name: null as string | null,
      additional_players: [] as typeof extraPlayers,
      status: 'tentative',
      amount_charged: BOOKING_PRICE_USD,
      focus_linkup_id: focusLinkupId ?? null,
      ghl_booking_id: primaryGhlId,
    },
    ...extraPlayers.map((p, i) => ({
      member_id: user.id,
      course_id: member.home_course_id,
      booking_date: bookingDate,
      tee_time: timeNormalized,
      players: 1,
      guest_name: [p.firstName, p.lastName].filter(Boolean).join(' ').trim() || p.email,
      player_member_id: p.memberId ?? null,
      additional_players: [p],
      status: 'tentative',
      amount_charged: BOOKING_PRICE_USD,
      focus_linkup_id: focusLinkupId ?? null,
      ghl_booking_id: guestGhlIds[i] ?? null,
    })),
  ]

  console.log('[booking/create] Inserting', rows.length, 'booking row(s)')

  const { data: insertedBookings, error: insertError } = await adminSupabase
    .from('bookings')
    .insert(rows)
    .select('*')

  if (insertError || !insertedBookings?.length) {
    console.error('[booking/create] Booking insert failed:', insertError)
    return NextResponse.json(
      { error: 'Failed to create booking records', detail: insertError?.message },
      { status: 500 }
    )
  }

  console.log('[booking/create] Bookings created:', insertedBookings.map(b => b.id))

  const primaryBookingId = insertedBookings[0]?.id ?? ''

  // Both GHL appointment and Supabase rows are committed — respond immediately.
  // Announcement + cache invalidation are non-critical and run after the response.
  const playerSuffix = totalPlayers > 1 ? ` +${extraPlayers.length} guest${extraPlayers.length !== 1 ? 's' : ''}` : ''
  const displayDate = format(new Date(`${bookingDate}T12:00:00`), 'EEEE, MMMM d')

  void adminSupabase
    .from('announcements')
    .insert({
      course_id: member.home_course_id,
      author_id: user.id,
      type: 'booking',
      title: `${memberName}${playerSuffix} is playing on ${displayDate}`,
      body: `${member.first_name} has booked a tee time at ${timeNormalized.slice(0, 5)} on ${displayDate}${totalPlayers > 1 ? ` for ${totalPlayers} players` : ''}. Want to join? Send them a message.`,
      metadata: {
        booking_id: primaryBookingId,
        booking_date: bookingDate,
        tee_time: timeNormalized,
        member_id: user.id,
      },
      status: 'published',
      published_at: new Date().toISOString(),
    })
    .then(({ error }) => {
      if (error) console.error('[booking/create] Announcement insert failed (non-fatal):', error)
    })

  void getCache(COURSE_ANN_NS).clear(courseAnnPrefix(member.home_course_id)).catch((e) => {
    console.error('[booking/create] Cache clear failed (non-fatal):', e)
  })

  console.log('[booking/create] Success, primaryBookingId:', primaryBookingId)

  return NextResponse.json({
    bookingId: primaryBookingId,
    bookings: insertedBookings,
    message: 'Booking submitted. We will confirm availability and send your payment link by email.',
  })
}
