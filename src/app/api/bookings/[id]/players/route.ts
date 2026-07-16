export const dynamic = 'force-dynamic'

// ============================================================
// POST /api/bookings/[id]/players
// Adds one or more players to an ALREADY-EXISTING booking group.
//
// Only the booker of the target booking may add players. Unlike
// POST /api/bookings/create, this route intentionally does NOT
// apply the booker's FIFO payment-due gate — that rule blocks
// creating a *new* booking, not expanding one you've already made,
// so a booker with a payment due can still add players here.
//
// It DOES still enforce:
//   • the per-course daily capacity (atomically, via
//     add_players_to_booking → DAY_FULL)
//   • the 4-players-per-group cap
//   • the member-guest FIFO gate (a member who owes on their own
//     round still can't be pulled into one — same policy as create)
//
// New rows are stamped with the parent group's created_at so they
// nest inside the existing booking card.
// ============================================================

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import {
  createBooking,
  getContactByEmail,
  resolveMeetingDurationMins,
} from '@/lib/ghl/client'
import { resolveAppointmentIso } from '@/lib/ghl/booking-time'
import { sendPushToMembers, sendPushToAdmins, NotificationTemplates } from '@/lib/push'
import { validateEmail, validateString, sanitiseText } from '@/lib/validation'
import { findMembersWithPendingPayment } from '@/lib/bookings/pending-payment'
import { format } from 'date-fns'
import { titleCaseName } from '@/lib/utils'
import type { AuthContext } from '@/lib/auth/types'
import type { AdditionalPlayer } from '@/types'
import {
  BOOKING_PRICE_USD,
  AVIARA_TIMEZONE,
  AVIARA_ADDRESS,
  FALLBACK_ROUND_DURATION_MINUTES,
  DEFAULT_MAX_PLAYERS_PER_DAY,
} from '@/lib/constants'

// A booking group is capped at 4 players total (mirrors create).
const MAX_PLAYERS_PER_GROUP = 4

// Statuses that still hold a seat in the group — used to count how many
// players the group already has before allowing more. Cancelled rows freed
// their spot, so they don't count toward the 4-player cap.
const ACTIVE_STATUSES = ['tentative', 'awaiting_approval', 'availability_confirmed', 'payment_confirmed', 'confirmed', 'pending']

export const POST = withAuth(async (
  req: NextRequest,
  ctx: AuthContext,
  routeCtx?: { params: Record<string, string> },
) => {
  const id = routeCtx?.params?.['id']
  if (!id) return NextResponse.json({ error: 'Missing booking id' }, { status: 400 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { additionalPlayers } = body as { additionalPlayers?: AdditionalPlayer[] }
  const rawExtraPlayers = additionalPlayers ?? []
  if (rawExtraPlayers.length === 0) {
    return NextResponse.json({ error: 'At least one player is required' }, { status: 400 })
  }

  const admin = createAdminClient()

  // ---- Load the target booking (the primary row of the group) -------------
  const { data: primary, error: primaryError } = await admin
    .from('bookings')
    .select('id, member_id, course_id, booking_date, tee_time, focus_linkup_id, created_at, status, guest_name, player_member_id')
    .eq('id', id)
    .single()

  if (primaryError || !primary) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  // Only the booker may add players. The primary row's member_id IS the booker.
  if (primary.member_id !== ctx.userId) {
    return NextResponse.json({ error: 'Only the booker can add players to this booking.' }, { status: 403 })
  }

  if (primary.status === 'cancelled') {
    return NextResponse.json({ error: 'This booking has been cancelled.' }, { status: 409 })
  }

  // Only upcoming rounds can gain players — booking_date is stored as the
  // course's own local calendar date, compared to today the same way.
  const todayStr = new Date().toISOString().slice(0, 10)
  if (primary.booking_date < todayStr) {
    return NextResponse.json({ error: 'This booking has already passed.' }, { status: 409 })
  }

  // ---- Validate the incoming players (mirrors create) ---------------------
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

  // Strip any HTML from free-text names before they reach GHL / the DB.
  const extraPlayers: AdditionalPlayer[] = rawExtraPlayers.map((p) => ({
    ...p,
    firstName: p.firstName ? sanitiseText(p.firstName) : p.firstName,
    lastName: p.lastName ? sanitiseText(p.lastName) : p.lastName,
  }))
  const nonMemberPlayers = extraPlayers.filter((p) => p.isNonMember || !p.memberId)
  const memberPlayers = extraPlayers.filter((p) => !(p.isNonMember || !p.memberId))

  // ---- Enforce the 4-players-per-group cap --------------------------------
  // Count the active rows already in this group (same booker, created_at, slot).
  const { count: existingCount } = await admin
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('member_id', ctx.userId)
    .eq('created_at', primary.created_at)
    .eq('booking_date', primary.booking_date)
    .eq('tee_time', primary.tee_time)
    .in('status', ACTIVE_STATUSES)

  const currentPlayers = existingCount ?? 1
  if (currentPlayers + extraPlayers.length > MAX_PLAYERS_PER_GROUP) {
    const remaining = Math.max(0, MAX_PLAYERS_PER_GROUP - currentPlayers)
    return NextResponse.json(
      {
        error: remaining > 0
          ? `You can add at most ${remaining} more player${remaining === 1 ? '' : 's'} to this booking.`
          : 'This booking is already full (4 players).',
      },
      { status: 409 },
    )
  }

  // ---- Resolve course + calendar settings ---------------------------------
  const { data: course } = await admin
    .from('courses')
    .select('id, ghl_calendar_id, timezone, name, address, city, state, payment_url, meeting_duration_mins, max_players_per_day')
    .eq('id', primary.course_id)
    .single()

  if (!course?.ghl_calendar_id) {
    return NextResponse.json({ error: 'This course is not set up for booking.' }, { status: 422 })
  }

  const eventCalendarId = course.ghl_calendar_id
  const eventTimezone = course.timezone || AVIARA_TIMEZONE
  const eventAddress = course.address || course.city || AVIARA_ADDRESS
  const eventCourseName = course.name
  const maxPlayersPerDay = course.max_players_per_day ?? DEFAULT_MAX_PLAYERS_PER_DAY
  const eventDurationMinutes = await resolveMeetingDurationMins(
    eventCalendarId,
    course.meeting_duration_mins || FALLBACK_ROUND_DURATION_MINUTES,
  )

  // ---- Resolve member guests from the DB (don't trust client details) -----
  const memberGuestIds = [...new Set(memberPlayers.map((p) => p.memberId).filter((mid): mid is string => Boolean(mid)))]
  const memberRowById: Record<string, { id: string; ghl_contact_id: string | null; email: string; phone: string | null; first_name: string; last_name: string }> = {}
  if (memberGuestIds.length) {
    const { data: guestRows } = await admin
      .from('members')
      .select('id, ghl_contact_id, email, phone, first_name, last_name')
      .in('id', memberGuestIds)
    for (const row of guestRows ?? []) memberRowById[row.id] = row

    for (const p of memberPlayers) {
      const row = p.memberId ? memberRowById[p.memberId] : undefined
      if (!row) {
        return NextResponse.json(
          { error: 'A selected member could not be found. Please remove and re-add them.' },
          { status: 422 },
        )
      }
      if (!row.ghl_contact_id) {
        return NextResponse.json(
          { error: `${row.first_name} ${row.last_name} can't be booked yet — please remove them and try again.` },
          { status: 422 },
        )
      }
      // A member can't be added to a slot they're already on.
      if (row.id === ctx.userId) {
        return NextResponse.json({ error: "You're already on this booking." }, { status: 409 })
      }
    }

    // Member-guest FIFO gate stays (same policy as create): a member who owes
    // on their own upcoming round can't be pulled into this one. This is
    // separate from the booker's gate, which we deliberately skip here.
    const guestsWithPending = await findMembersWithPendingPayment(admin, memberGuestIds)
    if (guestsWithPending.size) {
      const names = [...guestsWithPending].map((mid) => {
        const r = memberRowById[mid]
        return r ? titleCaseName(`${r.first_name} ${r.last_name}`.trim()) : 'A selected member'
      })
      const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
      const verb = names.length === 1 ? 'has' : 'have'
      return NextResponse.json(
        { error: `${list} ${verb} a payment due on an existing booking. Please remove them — they can be added once it's paid.`, blockedMemberIds: [...guestsWithPending] },
        { status: 409 },
      )
    }
  }

  // ---- A non-member must be genuinely new (mirrors create) ----------------
  for (const p of nonMemberPlayers) {
    const { data: memberMatches } = await admin
      .from('members')
      .select('id')
      .ilike('email', p.email)
      .limit(1)
    if (memberMatches && memberMatches.length > 0) {
      return NextResponse.json(
        { error: `${p.email} is already a LinkUp member — add them using member search instead.` },
        { status: 409 },
      )
    }
    const existingContact = await getContactByEmail(p.email)
    if (existingContact) {
      return NextResponse.json(
        { error: `${p.email} already exists in our system. Please use a different email or add them as a member.` },
        { status: 409 },
      )
    }
  }

  // ---- Build the appointment window from the stored slot ------------------
  let startIso: string
  let endIso: string
  try {
    ({ startIso, endIso } = resolveAppointmentIso(
      primary.booking_date,
      primary.tee_time,
      eventTimezone,
      eventDurationMinutes,
    ))
  } catch (err) {
    console.error('[booking/players] Invalid course timezone:', eventTimezone, String(err))
    return NextResponse.json(
      { error: 'This course is misconfigured (invalid timezone). Please contact support.' },
      { status: 422 },
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

  // ---- Build the new rows (one per added player) --------------------------
  // Member guests are booked in GHL below (status 'tentative'); non-members
  // are held for admin approval ('awaiting_approval') with no GHL appointment.
  const rows = [
    ...memberPlayers.map((p) => ({
      member_id: ctx.userId,
      course_id: primary.course_id,
      booking_date: primary.booking_date,
      tee_time: primary.tee_time,
      players: 1,
      guest_name: [p.firstName, p.lastName].filter(Boolean).join(' ').trim() || p.email,
      player_member_id: p.memberId ?? null,
      additional_players: [p],
      status: 'tentative',
      amount_charged: BOOKING_PRICE_USD,
      focus_linkup_id: primary.focus_linkup_id ?? null,
      ghl_booking_id: null as string | null,
    })),
    ...nonMemberPlayers.map((p) => ({
      member_id: ctx.userId,
      course_id: primary.course_id,
      booking_date: primary.booking_date,
      tee_time: primary.tee_time,
      players: 1,
      guest_name: [p.firstName, p.lastName].filter(Boolean).join(' ').trim() || p.email,
      player_member_id: null as string | null,
      additional_players: [p],
      status: 'awaiting_approval',
      amount_charged: BOOKING_PRICE_USD,
      focus_linkup_id: primary.focus_linkup_id ?? null,
      ghl_booking_id: null as string | null,
    })),
  ]

  // ---- Atomically reserve daily capacity + insert (NO booker FIFO check) ---
  const { data: insertedRows, error: insertError } = await admin.rpc('add_players_to_booking', {
    p_course_id: primary.course_id,
    p_date: primary.booking_date,
    p_capacity: maxPlayersPerDay,
    p_rows: rows,
    p_created_at: primary.created_at,
  })

  if (insertError) {
    const dayFull = /DAY_FULL:(\d+)/.exec(insertError.message ?? '')
    if (dayFull) {
      const seatsRemaining = parseInt(dayFull[1] ?? '0', 10)
      return NextResponse.json(
        {
          error: seatsRemaining > 0
            ? `Only ${seatsRemaining} spot${seatsRemaining === 1 ? '' : 's'} left for this date — please reduce your group or pick another day.`
            : 'This day is fully booked. No more players can be added.',
          seatsRemaining,
        },
        { status: 409 },
      )
    }

    // A curated (custom) tee time filled up or had its seats lowered before this
    // add landed — surface the slot's live remaining seats.
    const slotFull = /SLOT_FULL:(\d{2}:\d{2}):(\d+)/.exec(insertError.message ?? '')
    if (slotFull) {
      const seatsRemaining = parseInt(slotFull[2] ?? '0', 10)
      return NextResponse.json(
        {
          error: seatsRemaining > 0
            ? `Only ${seatsRemaining} spot${seatsRemaining === 1 ? '' : 's'} left for this tee time — please add fewer players.`
            : 'This tee time is full. No more players can be added to it.',
          seatsRemaining,
        },
        { status: 409 },
      )
    }
    console.error('[booking/players] Insert failed:', insertError)
    return NextResponse.json({ error: 'Failed to add player. Please try again.' }, { status: 500 })
  }

  type InsertedBooking = { id: string; player_member_id: string | null; guest_name: string | null }
  const created = (insertedRows ?? []) as InsertedBooking[]

  // ---- Create GHL appointments for member guests (non-fatal) --------------
  await Promise.all(
    created
      .filter((b) => b.player_member_id)
      .map(async (b) => {
        const row = b.player_member_id ? memberRowById[b.player_member_id] : undefined
        if (!row?.ghl_contact_id) return
        try {
          const ghlId = await createBooking({
            ...bookingParams,
            contact: { id: row.ghl_contact_id, email: row.email, phone: row.phone ?? null },
          })
          await admin.from('bookings').update({ ghl_booking_id: ghlId }).eq('id', b.id)
        } catch (err) {
          console.warn('[booking/players] Guest GHL appointment failed (non-fatal):', row.email, String(err))
        }
      }),
  )

  const displayDate = format(new Date(`${primary.booking_date}T12:00:00`), 'EEEE, MMMM d')
  const displayTime = primary.tee_time.slice(0, 5)

  // Notify invited members.
  const invitedMemberIds = memberPlayers.map((p) => p.memberId).filter((mid): mid is string => Boolean(mid))
  if (invitedMemberIds.length) {
    const { data: booker } = await admin
      .from('members')
      .select('first_name')
      .eq('id', ctx.userId)
      .single()
    void sendPushToMembers(
      invitedMemberIds,
      NotificationTemplates.bookingInvite(booker?.first_name ?? 'A member', displayDate, displayTime),
    ).catch(() => {})
  }

  // Alert admins for any non-member guests awaiting approval.
  if (nonMemberPlayers.length) {
    const { data: booker } = await admin
      .from('members')
      .select('first_name, last_name')
      .eq('id', ctx.userId)
      .single()
    const bookerName = `${booker?.first_name ?? ''} ${booker?.last_name ?? ''}`.trim() || 'A member'
    void sendPushToAdmins(
      NotificationTemplates.nonMemberBookingRequest(bookerName, nonMemberPlayers.length, displayDate, displayTime),
    ).catch(() => {})
  }

  // Echo the resolved course onto each new row so the client can render it
  // immediately (the RPC returns raw rows with no join).
  const courseForResponse = {
    name: course.name,
    city: course.city,
    state: course.state,
    payment_url: course.payment_url ?? null,
    timezone: course.timezone,
  }
  const bookingsWithCourse = created.map((b) => ({ ...b, course: courseForResponse }))

  return NextResponse.json({
    bookings: bookingsWithCourse,
    pendingNonMembers: nonMemberPlayers.length,
    message: nonMemberPlayers.length
      ? `Player added. ${nonMemberPlayers.length} non-member guest${nonMemberPlayers.length !== 1 ? 's are' : ' is'} pending admin approval.`
      : 'Player added.',
  })
})
