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
//
// GET /api/bookings/create?month=YYYY-MM&courseId=...
//   Returns available tee-time slots from the GHL Aviara calendar.
// ============================================================

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createRouteHandlerClient, createAdminClient } from '@/lib/supabase-server'
import { getAvailableSlots, createBooking, getContactByEmail, resolveMeetingDurationMins } from '@/lib/ghl/client'
import { resolveAppointmentIso } from '@/lib/ghl/booking-time'
import { sendPushToMembers, sendPushToAdmins, NotificationTemplates } from '@/lib/push'
import { validateEmail, validateString, sanitiseText } from '@/lib/validation'
import { findPendingPaymentBookings, findMembersWithPendingPayment, pendingPaymentBlockMessage } from '@/lib/bookings/pending-payment'
import { buildCustomSlots } from '@/lib/bookings/availability'
import { format } from 'date-fns'
import { titleCaseName } from '@/lib/utils'
import type { AdditionalPlayer } from '@/types'

// Total players per booking is capped at 4 (mirrors validateBookingPayload),
// so at most 3 additional players may accompany the primary booker.
const MAX_ADDITIONAL_PLAYERS = 3
import {
  BOOKING_PRICE_USD,
  AVIARA_TIMEZONE,
  AVIARA_ADDRESS,
  FALLBACK_ROUND_DURATION_MINUTES,
  DEFAULT_MAX_PLAYERS_PER_DAY,
} from '@/lib/constants'

const AVIARA_CALENDAR_ID = process.env.GHL_AVIARA_CALENDAR_ID ?? ''
const AVIARA_CALENDAR_USER_ID = process.env.GHL_AVIARA_CALENDAR_USER_ID ?? ''

// ============================================================
// GET /api/bookings/create?month=YYYY-MM&courseId=...
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

  const courseId = searchParams.get('courseId')

  const [yearStr, monthStr] = month.split('-')
  const year = parseInt(yearStr ?? '0', 10)
  const monthIdx = parseInt(monthStr ?? '1', 10) - 1
  const startDate = format(new Date(year, monthIdx, 1), 'yyyy-MM-dd')
  const endDate = format(new Date(year, monthIdx + 1, 0), 'yyyy-MM-dd')

  let calendarId = AVIARA_CALENDAR_ID
  // Slot listing is always displayed in the *course's own* timezone — a tee
  // time is an appointment at that venue's local wall-clock time, regardless
  // of where the browsing member happens to be.
  let timezone = AVIARA_TIMEZONE
  let calendarUserId: string | undefined = AVIARA_CALENDAR_USER_ID || undefined

  // Only used if GHL can't tell us the calendar's own slot duration.
  let fallbackDurationMins = FALLBACK_ROUND_DURATION_MINUTES
  let storedDurationMins: number | null = null
  let customSlotsEnabled = false

  if (courseId) {
    const adminSupabase = createAdminClient()
    const { data: course } = await adminSupabase
      .from('courses')
      .select('ghl_calendar_id, ghl_calendar_user_id, timezone, meeting_duration_mins, custom_slots_enabled')
      .eq('id', courseId)
      .eq('approval_status', 'active')
      .single()

    if (!course?.ghl_calendar_id) {
      return NextResponse.json({ error: 'Course not found or booking not yet configured' }, { status: 404 })
    }
    calendarId = course.ghl_calendar_id
    calendarUserId = course.ghl_calendar_user_id || undefined
    timezone = course.timezone || AVIARA_TIMEZONE
    storedDurationMins = course.meeting_duration_mins ?? null
    fallbackDurationMins = course.meeting_duration_mins || FALLBACK_ROUND_DURATION_MINUTES
    customSlotsEnabled = course.custom_slots_enabled === true
  }

  // The round length comes from this course's GHL calendar, so the client can
  // render "until ~X" without assuming any duration of its own.
  const durationMins = await resolveMeetingDurationMins(calendarId, fallbackDurationMins)

  // Browsing tee times is the most frequent read of a calendar's rules, so use it
  // to keep the course row's mirror of the duration current. Screens that can't
  // reach GHL themselves (the admin bookings list) read that mirror.
  if (courseId && storedDurationMins !== durationMins) {
    void createAdminClient()
      .from('courses')
      .update({ meeting_duration_mins: durationMins })
      .eq('id', courseId)
      .then(() => {}, () => {})
  }

  const ghlSlots = await getAvailableSlots({
    calendarId,
    startDate,
    endDate,
    timezone,
    userId: calendarUserId,
    sendSeatsPerSlot: true,
    fallbackDurationMins,
  })

  // Custom courses: admin curation applies ONLY to the specific dates that have
  // curated rows — those dates use the custom tee times instead of GHL's. Every
  // other date is left untouched and keeps its normal GHL availability.
  const slots = customSlotsEnabled && courseId
    ? { ...ghlSlots, ...(await buildCustomSlots(createAdminClient(), courseId, startDate, endDate, timezone, durationMins)) }
    : ghlSlots

  return NextResponse.json({ slots, timezone, durationMins })
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

  const { startTime: slotStartTime, focusLinkupId, additionalPlayers, courseId } = body as {
    startTime: string
    focusLinkupId?: string
    additionalPlayers?: AdditionalPlayer[]
    courseId?: string
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

  // Convert slot ISO datetime to date + time in event/Aviara timezone
  const slotMoment = new Date(slotStartTime)
  if (isNaN(slotMoment.getTime())) {
    return NextResponse.json({ error: 'Invalid startTime value' }, { status: 400 })
  }

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

  // First-in-first-out: a member may only hold bookings awaiting payment
  // (status 'availability_confirmed' — a payment link has been sent) — every
  // one of them must be paid before another booking can be created, across
  // any course. Since this rule is being added to an app already in
  // production, a member may already have more than one booking awaiting
  // payment on their account; surface all of them, not just one. Check this
  // before touching GHL so a blocked member fails fast with a clear message.
  const pendingBookings = await findPendingPaymentBookings(adminSupabase, user.id)
  if (pendingBookings.length) {
    return NextResponse.json(
      { error: pendingPaymentBlockMessage(pendingBookings), pendingBookings },
      { status: 409 },
    )
  }

  // Resolve course calendar settings — use the selected course when provided,
  // fall back to the Aviara env-var constants for backward compatibility.
  let eventCalendarId = AVIARA_CALENDAR_ID
  let eventTimezone = AVIARA_TIMEZONE
  let eventAddress = AVIARA_ADDRESS
  let eventDurationMinutes = FALLBACK_ROUND_DURATION_MINUTES
  let eventCourseName = 'Aviara'
  let resolvedCourseId: string = member.home_course_id
  // Course details echoed back on the created rows so the client can render the
  // correct course name immediately (the create RPC doesn't join `courses`).
  let courseForResponse: { name: string; city: string; state: string; payment_url: string | null; timezone: string } | null = null

  const { data: course } = await adminSupabase
    .from('courses')
    .select('id, ghl_calendar_id, ghl_calendar_user_id, timezone, name, address, city, state, payment_url, meeting_duration_mins, cost_per_player')
    .eq('id', courseId || resolvedCourseId)
    .eq('approval_status', 'active')
    .single()

  if (courseId) {
    if (!course?.ghl_calendar_id) {
      return NextResponse.json({ error: 'Course not found or booking not yet configured' }, { status: 404 })
    }
    eventCalendarId = course.ghl_calendar_id
    eventTimezone = course.timezone || AVIARA_TIMEZONE
    eventAddress = course.address || course.city || AVIARA_ADDRESS
    eventDurationMinutes = course.meeting_duration_mins || FALLBACK_ROUND_DURATION_MINUTES
    eventCourseName = course.name
    resolvedCourseId = course.id
  }

  // The appointment's length is whatever this course's GHL calendar says a round
  // is. The course row only supplies the fallback for when GHL is unreachable.
  eventDurationMinutes = await resolveMeetingDurationMins(eventCalendarId, eventDurationMinutes)

  // Keep the course row in step with GHL so the member and admin screens can show
  // the right end time without each of them calling GHL. Best-effort.
  if (course && course.meeting_duration_mins !== eventDurationMinutes) {
    void adminSupabase
      .from('courses')
      .update({ meeting_duration_mins: eventDurationMinutes })
      .eq('id', course.id)
      .then(() => {}, () => {})
  }

  if (course) {
    courseForResponse = {
      name: course.name,
      city: course.city,
      state: course.state,
      payment_url: course.payment_url ?? null,
      timezone: course.timezone,
    }
  }

  const localParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: eventTimezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(slotMoment)
  const lp = (type: string) => localParts.find(p => p.type === type)?.value ?? '00'
  const bookingDate = `${lp('year')}-${lp('month')}-${lp('day')}`
  const timeNormalized = `${lp('hour')}:${lp('minute')}:${lp('second')}`

  console.log('[booking/create] Resolved in event/Aviara timezone:', { bookingDate, timeNormalized })
  const memberName = `${member.first_name} ${member.last_name}`

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

    // The FIFO gate also applies to member guests: a booker can't pull a fellow
    // member into a group round while that member still owes for one of their
    // own. Block the whole booking with a name-specific message so the booker
    // knows exactly who to remove — mirrors the client-side flag, and is the
    // authoritative check (runs before any GHL work).
    const guestsWithPending = await findMembersWithPendingPayment(adminSupabase, memberGuestIds)
    if (guestsWithPending.size) {
      const names = [...guestsWithPending].map((id) => {
        const r = memberRowById[id]
        return r ? titleCaseName(`${r.first_name} ${r.last_name}`.trim()) : 'A selected member'
      })
      const list =
        names.length === 1
          ? names[0]
          : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
      const verb = names.length === 1 ? 'has' : 'have'
      return NextResponse.json(
        {
          error: `${list} ${verb} a payment due on an existing booking. Please remove them — they can be added once it's paid.`,
          blockedMemberIds: [...guestsWithPending],
        },
        { status: 409 }
      )
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
  // A misconfigured course timezone (invalid IANA string) throws here — the admin
  // routes validate on write, but this guards against any pre-existing bad data.
  let startIso: string
  let endIso: string
  try {
    ({ startIso, endIso } = resolveAppointmentIso(bookingDate, timeNormalized, eventTimezone, eventDurationMinutes))
  } catch (err) {
    console.error('[booking/create] Invalid course timezone:', eventTimezone, String(err))
    return NextResponse.json(
      { error: 'This course is misconfigured (invalid timezone). Please contact support.' },
      { status: 422 }
    )
  }

  const bookingParams = {
    calendarId: eventCalendarId,
    title: `LinkUp @ ${eventCourseName}`,
    startTime: startIso,
    endTime: endIso,
    timezone: eventTimezone,
    address: eventAddress,
  }

  // ---- Daily capacity: max players per course per DATE ---------------------
  // Read the per-course cap (courses.max_players_per_day). The actual count +
  // reservation happen atomically in our DB below (create_bookings_for_day),
  // scoped to this course + date across all tee times.
  const { data: capRow } = await adminSupabase
    .from('courses')
    .select('max_players_per_day')
    .eq('id', resolvedCourseId)
    .single()
  const maxPlayersPerDay = capRow?.max_players_per_day ?? DEFAULT_MAX_PLAYERS_PER_DAY

  // Step 1: Build one booking row per player. GHL appointments are created
  // AFTER the DB reserves the seats, so ghl_booking_id starts null and is
  // backfilled below. Every row consumes a seat: the booker, each member
  // guest, and each pending non-member (held while awaiting admin approval).
  const rows = [
    {
      member_id: user.id,
      course_id: resolvedCourseId,
      booking_date: bookingDate,
      tee_time: timeNormalized,
      players: 1,
      guest_name: null as string | null,
      player_member_id: null as string | null,
      additional_players: [] as typeof extraPlayers,
      status: 'tentative',
      amount_charged: BOOKING_PRICE_USD,
      focus_linkup_id: focusLinkupId ?? null,
      ghl_booking_id: null as string | null,
    },
    ...memberPlayers.map((p) => ({
      member_id: user.id,
      course_id: resolvedCourseId,
      booking_date: bookingDate,
      tee_time: timeNormalized,
      players: 1,
      guest_name: [p.firstName, p.lastName].filter(Boolean).join(' ').trim() || p.email,
      player_member_id: p.memberId ?? null,
      additional_players: [p],
      status: 'tentative',
      amount_charged: BOOKING_PRICE_USD,
      focus_linkup_id: focusLinkupId ?? null,
      ghl_booking_id: null as string | null,
    })),
    // Non-members are held for admin review: a booking row in 'awaiting_approval'
    // with no GHL appointment. An admin "sets it up" (creates the GHL contact +
    // appointment, status → tentative) or rejects it (status → cancelled).
    ...nonMemberPlayers.map((p) => ({
      member_id: user.id,
      course_id: resolvedCourseId,
      booking_date: bookingDate,
      tee_time: timeNormalized,
      players: 1,
      guest_name: [p.firstName, p.lastName].filter(Boolean).join(' ').trim() || p.email,
      player_member_id: null as string | null,
      additional_players: [p],
      status: 'awaiting_approval',
      amount_charged: BOOKING_PRICE_USD,
      focus_linkup_id: focusLinkupId ?? null,
      ghl_booking_id: null as string | null,
    })),
  ]

  // Step 2: Atomically reserve seats + insert rows. The DB serializes
  // concurrent bookings for this course+date under an advisory lock and rejects
  // the WHOLE group if it would exceed the daily cap (raises DAY_FULL:<remaining>).
  console.log('[booking/create] Reserving', rows.length, 'seat(s); daily cap', maxPlayersPerDay)

  const { data: insertedBookings, error: insertError } = await adminSupabase
    .rpc('create_bookings_for_day', {
      p_course_id: resolvedCourseId,
      p_date: bookingDate,
      p_capacity: maxPlayersPerDay,
      p_rows: rows,
    })

  if (insertError) {
    // Atomic FIFO backstop: a payment link came due for the booker or a member
    // guest between the earlier check and this reservation (e.g. a GHL webhook
    // fired mid-flight). No GHL appointment has been created yet, so there's
    // nothing to unwind — just surface who now owes.
    const pendingRace = /PENDING_PAYMENT:([0-9a-f,\-]+)/i.exec(insertError.message ?? '')
    if (pendingRace) {
      const ids = new Set(
        (pendingRace[1] ?? '').split(',').map(s => s.trim()).filter(Boolean)
      )
      const bookerBlocked = ids.has(user.id)
      const guestNames = [...ids]
        .filter(id => id !== user.id)
        .map(id => {
          const r = memberRowById[id]
          return r ? titleCaseName(`${r.first_name} ${r.last_name}`.trim()) : 'A player'
        })
      let error: string
      if (guestNames.length === 0) {
        // Only the booker owes.
        error = 'A payment just came due on one of your bookings. Please pay it before booking again.'
      } else {
        const list =
          guestNames.length === 1
            ? guestNames[0]
            : `${guestNames.slice(0, -1).join(', ')} and ${guestNames[guestNames.length - 1]}`
        const verb = guestNames.length === 1 ? 'has' : 'have'
        error = bookerBlocked
          ? `A payment just came due for you and ${list}. Please resolve it and try again.`
          : `${list} just ${verb} a payment due on an existing booking. Please remove them and try again.`
      }
      return NextResponse.json({ error, blockedMemberIds: [...ids] }, { status: 409 })
    }

    const dayFull = /DAY_FULL:(\d+)/.exec(insertError.message ?? '')
    if (dayFull) {
      const seatsRemaining = parseInt(dayFull[1] ?? '0', 10)
      return NextResponse.json(
        {
          error: seatsRemaining > 0
            ? `Only ${seatsRemaining} spot${seatsRemaining === 1 ? '' : 's'} left for this date — please reduce your group or pick another day.`
            : 'This day is fully booked. Please pick another day.',
          seatsRemaining,
        },
        { status: 409 }
      )
    }

    // A curated (custom) tee time filled up — or the admin lowered its seats —
    // between the member loading availability and submitting. The slot's live
    // remaining seats are in the error so the client can prompt an adjustment.
    const slotFull = /SLOT_FULL:(\d{2}:\d{2}):(\d+)/.exec(insertError.message ?? '')
    if (slotFull) {
      const seatsRemaining = parseInt(slotFull[2] ?? '0', 10)
      return NextResponse.json(
        {
          error: seatsRemaining > 0
            ? `Only ${seatsRemaining} spot${seatsRemaining === 1 ? '' : 's'} left for this tee time — please reduce your group or pick another slot.`
            : 'This tee time just filled up. Please pick another slot.',
          seatsRemaining,
        },
        { status: 409 }
      )
    }
    console.error('[booking/create] Slot reservation failed:', insertError)
    return NextResponse.json(
      { error: 'Failed to create booking records', detail: insertError.message },
      { status: 500 }
    )
  }

  if (!insertedBookings?.length) {
    return NextResponse.json({ error: 'Failed to create booking records' }, { status: 500 })
  }

  type InsertedBooking = { id: string; guest_name: string | null; player_member_id: string | null; ghl_booking_id: string | null }
  const created = insertedBookings as InsertedBooking[]
  console.log('[booking/create] Reserved bookings:', created.map(b => b.id))

  // Step 3: Now that the seats are reserved, create GHL appointments and
  // backfill ghl_booking_id. The primary booker's appointment MUST succeed —
  // if it fails we release the reservation by deleting the reserved rows.
  const primaryBooking = created.find(b => b.guest_name === null && b.player_member_id === null) ?? created[0]
  if (!primaryBooking) {
    return NextResponse.json({ error: 'Failed to create booking records' }, { status: 500 })
  }

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
    console.error('[booking/create] GHL appointment failed, releasing reservation:', String(err))
    await adminSupabase.from('bookings').delete().in('id', created.map(b => b.id))
    return NextResponse.json(
      { error: 'Failed to create appointment in GHL. Please try again.', detail: String(err) },
      { status: 502 }
    )
  }

  await adminSupabase.from('bookings').update({ ghl_booking_id: primaryGhlId }).eq('id', primaryBooking.id)
  primaryBooking.ghl_booking_id = primaryGhlId
  console.log('[booking/create] GHL appointment created for primary:', primaryGhlId)

  // Member-guest appointments are non-fatal — a failure just leaves that row
  // without a GHL appointment. Non-member rows are skipped (awaiting approval).
  await Promise.all(
    created
      .filter(b => b.player_member_id)
      .map(async (b) => {
        const row = b.player_member_id ? memberRowById[b.player_member_id] : undefined
        if (!row?.ghl_contact_id) return
        try {
          const ghlId = await createBooking({
            ...bookingParams,
            contact: { id: row.ghl_contact_id, email: row.email, phone: row.phone ?? null },
          })
          await adminSupabase.from('bookings').update({ ghl_booking_id: ghlId }).eq('id', b.id)
          b.ghl_booking_id = ghlId // reflect into the response payload (same array ref)
          console.log('[booking/create] GHL appointment created for guest:', row.email, ghlId)
        } catch (err) {
          console.warn('[booking/create] Guest GHL appointment failed (non-fatal):', row.email, String(err))
        }
      })
  )

  const primaryBookingId = primaryBooking.id

  const displayDate = format(new Date(`${bookingDate}T12:00:00`), 'EEEE, MMMM d')

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

  // Echo the resolved course onto each row so the client's optimistic prepend
  // renders the real course name (the RPC returns raw rows with no join).
  const bookingsWithCourse = Array.isArray(insertedBookings) && courseForResponse
    ? insertedBookings.map((b: Record<string, unknown>) => ({ ...b, course: courseForResponse }))
    : insertedBookings

  return NextResponse.json({
    bookingId: primaryBookingId,
    bookings: bookingsWithCourse,
    pendingNonMembers: nonMemberPlayers.length,
    message,
  })
}
