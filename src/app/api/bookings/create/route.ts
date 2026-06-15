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
import { getAvailableSlots, createBooking, getContactByEmail } from '@/lib/ghl/client'
import { resolveAviaraAppointmentIso } from '@/lib/ghl/booking-time'
import { getCache } from '@/lib/cache'
import { COURSE_ANN_NS, courseAnnPrefix } from '@/lib/cache/keys'
import { sendPushToMembers, sendPushToAdmins, NotificationTemplates } from '@/lib/push'
import { validateEmail, validateString, sanitiseText } from '@/lib/validation'
import { format } from 'date-fns'
import type { AdditionalPlayer } from '@/types'

// Total players per booking is capped at 4 (mirrors validateBookingPayload),
// so at most 3 additional players may accompany the primary booker.
const MAX_ADDITIONAL_PLAYERS = 3
import {
  BOOKING_PRICE_USD,
  AVIARA_TIMEZONE,
  AVIARA_ADDRESS,
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
    additionalPlayers?: AdditionalPlayer[]
  }
  const rawExtraPlayers = additionalPlayers ?? []

  if (!slotStartTime) {
    return NextResponse.json({ error: 'startTime is required' }, { status: 400 })
  }

  // Cap the group server-side — the client limit is advisory only.
  if (rawExtraPlayers.length > MAX_ADDITIONAL_PLAYERS) {
    return NextResponse.json({ error: 'A booking can include at most 4 players' }, { status: 400 })
  }

  // Players added without a member account are non-member invites: they need a
  // valid email and phone (names are optional) and trigger an admin alert.
  for (const p of rawExtraPlayers) {
    if (!validateEmail(p.email).valid) {
      return NextResponse.json({ error: 'A valid email is required for each added player' }, { status: 400 })
    }
    for (const name of [p.firstName, p.lastName]) {
      if (name && !validateString(name, 'name', { max: 100 }).valid) {
        return NextResponse.json({ error: 'Player names must be 100 characters or fewer' }, { status: 400 })
      }
    }
    const isNonMember = p.isNonMember || !p.memberId
    if (isNonMember && (typeof p.mobile !== 'string' || p.mobile.trim().length < 7)) {
      return NextResponse.json({ error: 'A phone number is required for each non-member guest' }, { status: 400 })
    }
  }

  // Strip any HTML from free-text names before they reach GHL, the bookings
  // table, or the admin CSV export.
  const extraPlayers: AdditionalPlayer[] = rawExtraPlayers.map((p) => ({
    ...p,
    firstName: p.firstName ? sanitiseText(p.firstName) : p.firstName,
    lastName: p.lastName ? sanitiseText(p.lastName) : p.lastName,
  }))
  // Non-members are NOT booked in GHL here — they're held as pending requests
  // for admin approval. Only the booker and existing-member guests are booked.
  const nonMemberPlayers = extraPlayers.filter((p) => p.isNonMember || !p.memberId)
  const memberPlayers = extraPlayers.filter((p) => !(p.isNonMember || !p.memberId))

  console.log('[booking/create] Request:', {
    userId: user.id,
    slotStartTime,
    memberGuests: memberPlayers.length,
    nonMemberGuests: nonMemberPlayers.length,
  })

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
  // Non-members are pending approval, so they don't count toward the confirmed
  // group size used for the GHL booking and community announcement.
  const totalPlayers = 1 + memberPlayers.length

  // ---- Validate everyone up front, before touching GHL --------------------
  // Fail fast with a clear message rather than getting partway through and
  // hitting an opaque GHL error.

  // 1. The booker must have a GHL contact to create their appointment.
  if (!member.ghl_contact_id) {
    return NextResponse.json(
      { error: "Your account isn't set up for booking yet. Please contact support." },
      { status: 422 }
    )
  }

  // 2. Resolve every member guest from the database (don't trust client-supplied
  //    details) and confirm each exists and has a GHL contact.
  const memberGuestIds = [...new Set(memberPlayers.map(p => p.memberId).filter((id): id is string => Boolean(id)))]
  const memberRowById: Record<string, { id: string; ghl_contact_id: string | null; email: string; phone: string | null; first_name: string; last_name: string }> = {}
  if (memberGuestIds.length) {
    const { data: guestRows } = await adminSupabase
      .from('members')
      .select('id, ghl_contact_id, email, phone, first_name, last_name')
      .in('id', memberGuestIds)
    for (const row of guestRows ?? []) memberRowById[row.id] = row

    for (const p of memberPlayers) {
      const row = p.memberId ? memberRowById[p.memberId] : undefined
      if (!row) {
        return NextResponse.json(
          { error: 'A selected member could not be found. Please remove and re-add them.' },
          { status: 422 }
        )
      }
      if (!row.ghl_contact_id) {
        return NextResponse.json(
          { error: `${row.first_name} ${row.last_name} can't be booked yet — please remove them and try again.` },
          { status: 422 }
        )
      }
    }
  }

  // 3. A non-member must be genuinely new. Reject any whose email already belongs to
  // a LinkUp member or an existing GHL contact (those should be added via member
  // search, not as a guest). Run before any GHL appointment is created.
  for (const p of nonMemberPlayers) {
    const { data: memberMatches } = await adminSupabase
      .from('members')
      .select('id')
      .ilike('email', p.email)
      .limit(1)
    if (memberMatches && memberMatches.length > 0) {
      return NextResponse.json(
        { error: `${p.email} is already a LinkUp member — add them using member search instead.` },
        { status: 409 }
      )
    }

    const existingContact = await getContactByEmail(p.email)
    if (existingContact) {
      return NextResponse.json(
        { error: `${p.email} already exists in our system. Please use a different email or add them as a member.` },
        { status: 409 }
      )
    }
  }

  // Build start/end ISO strings with AVIARA_TIMEZONE offset — format: "YYYY-MM-DDTHH:MM:SS±HHMM"
  const { startIso, endIso } = resolveAviaraAppointmentIso(bookingDate, timeNormalized)

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

  // Step 1b: Create GHL appointments for each member guest in parallel (non-fatal),
  // using their validated GHL contact from the database. Non-member guests are
  // intentionally skipped — they only reach GHL once an admin sets them up.
  const memberGhlIds = await Promise.all(
    memberPlayers.map(async (p) => {
      const row = p.memberId ? memberRowById[p.memberId] : undefined
      if (!row?.ghl_contact_id) return null
      try {
        const ghlId = await createBooking({
          ...bookingParams,
          contact: { id: row.ghl_contact_id, email: row.email, phone: row.phone ?? null },
        })
        console.log('[booking/create] GHL appointment created for guest:', row.email, ghlId)
        return ghlId
      } catch (err) {
        console.warn('[booking/create] Guest GHL appointment failed (non-fatal):', row.email, String(err))
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
    ...memberPlayers.map((p, i) => ({
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
      ghl_booking_id: memberGhlIds[i] ?? null,
    })),
    // Non-members are held for admin review: a booking row in 'awaiting_approval'
    // with no GHL appointment. An admin "sets it up" (creates the GHL contact +
    // appointment, status → tentative) or rejects it (status → cancelled).
    ...nonMemberPlayers.map((p) => ({
      member_id: user.id,
      course_id: member.home_course_id,
      booking_date: bookingDate,
      tee_time: timeNormalized,
      players: 1,
      guest_name: [p.firstName, p.lastName].filter(Boolean).join(' ').trim() || p.email,
      player_member_id: null,
      additional_players: [p],
      status: 'awaiting_approval',
      amount_charged: BOOKING_PRICE_USD,
      focus_linkup_id: focusLinkupId ?? null,
      ghl_booking_id: null,
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

  const primaryBookingId =
    (insertedBookings.find(b => b.guest_name === null) ?? insertedBookings[0])?.id ?? ''

  // Both GHL appointment and Supabase rows are committed — respond immediately.
  // Announcement + cache invalidation are non-critical and run after the response.
  const playerSuffix = totalPlayers > 1 ? ` +${memberPlayers.length} guest${memberPlayers.length !== 1 ? 's' : ''}` : ''
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

  // Notify members who were invited as additional players
  const invitedMemberIds = memberPlayers
    .map(p => p.memberId)
    .filter((id): id is string => Boolean(id))
  if (invitedMemberIds.length) {
    const displayTime = timeNormalized.slice(0, 5)
    void sendPushToMembers(
      invitedMemberIds,
      NotificationTemplates.bookingInvite(member.first_name, displayDate, displayTime)
    ).catch(() => {})
  }

  // Alert admins so they can set up (or reject) each non-member guest. The
  // 'awaiting_approval' booking rows above are the moderation queue.
  if (nonMemberPlayers.length) {
    void sendPushToAdmins(
      NotificationTemplates.nonMemberBookingRequest(
        memberName,
        nonMemberPlayers.length,
        displayDate,
        timeNormalized.slice(0, 5)
      )
    ).catch(() => {})
  }

  console.log('[booking/create] Success, primaryBookingId:', primaryBookingId)

  const message = nonMemberPlayers.length
    ? `Booking submitted. ${nonMemberPlayers.length} non-member guest${nonMemberPlayers.length !== 1 ? 's' : ''} ${nonMemberPlayers.length !== 1 ? 'are' : 'is'} pending admin approval — we'll confirm availability and send your payment link by email.`
    : 'Booking submitted. We will confirm availability and send your payment link by email.'

  return NextResponse.json({
    bookingId: primaryBookingId,
    bookings: insertedBookings,
    pendingNonMembers: nonMemberPlayers.length,
    message,
  })
}
