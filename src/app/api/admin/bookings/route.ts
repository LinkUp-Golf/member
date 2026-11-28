export const dynamic = 'force-dynamic'

// ============================================================
// POST /api/admin/bookings
//   body {
//     courseId: uuid,
//     date: 'YYYY-MM-DD',
//     teeTime: 'HH:MM',
//     players: [{ name, email?, phone? }, …]
//   }
//
// An admin putting players on a tee time — a new one, or one already booked.
// A name is all that's needed; nothing asks or shows whether the person is a
// member or a guest, and nothing limits how many (see
// @/lib/bookings/admin-players for what's skipped and why).
//
// For each player, before any row is written:
//   * an email that belongs to an account → that account;
//   * an email with no account → a GHL contact and a guest login
//     (provisionNonMemberGuest);
//   * no email → a GHL contact from the name and phone, and no login.
// A player whose GHL contact can't be made is still seated — the admin is told
// that seat isn't on the GHL calendar.
//
// Then one row per player (their own round where they have an account, a
// named seat otherwise — see adminSeatOwnership), a GHL appointment for each player with
// a contact (ignoring the calendar's free seats, so a full tee time takes it),
// the venue's playing host if this is the day's first foursome, and a
// "You're booked in" to everyone with an account. The cron reminds them like
// any other player.
//
// Every seat is "Paying at club": every round is paid at the pro shop, and a
// seat booked by an admin must never put the admin on the unpaid-booking gate.
// ============================================================

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { format } from 'date-fns'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { createBooking, createContact, resolveMeetingDurationMins } from '@/lib/ghl/client'
import { resolveAppointmentIso } from '@/lib/ghl/booking-time'
import { provisionNonMemberGuest } from '@/lib/bookings/non-member-guest'
import {
  adminSeatOwnership,
  normaliseTeeTime,
  parseAdminPlayers,
  type AdminPlayer,
} from '@/lib/bookings/admin-players'
import { bookingAmountDue } from '@/lib/bookings/price'
import { PAY_AT_CLUB } from '@/lib/bookings/payment-options'
import { seatPlayingHost } from '@/lib/bookings/playing-host'
import { NotificationTemplates } from '@/lib/push'
import { notifyMember } from '@/lib/notify'
import { sanitiseText, validateDate, validateUUID } from '@/lib/validation'
import { formatTeeTime } from '@/lib/utils'
import { logger } from '@/lib/logger'
import { GHLError } from '@/lib/errors/app-error'
import {
  AVIARA_ADDRESS,
  AVIARA_TIMEZONE,
  DEFAULT_MAX_PLAYERS_PER_DAY,
  FALLBACK_ROUND_DURATION_MINUTES,
  PAY_AT_CLUB_BOOKING_STATUS,
} from '@/lib/constants'
import type { AuthContext } from '@/lib/auth/types'

type Admin = ReturnType<typeof createAdminClient>

/** Who a player turned out to be: the account to link, and the GHL contact to book. */
interface Resolved {
  player: AdminPlayer
  memberId: string | null
  contactId: string | null
  /** Said to the admin when a seat couldn't be put on the GHL calendar. */
  warning: string | null
}

export const POST = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

  const courseId = typeof body.courseId === 'string' ? body.courseId : ''
  if (!validateUUID(courseId, 'venue').valid) {
    return NextResponse.json({ error: 'Choose a venue.' }, { status: 400 })
  }
  const date = typeof body.date === 'string' ? body.date : ''
  if (!validateDate(date, 'date').valid) {
    return NextResponse.json({ error: 'Choose a date.' }, { status: 400 })
  }
  const teeTime = normaliseTeeTime(body.teeTime)
  if (!teeTime) return NextResponse.json({ error: 'Choose a tee time.' }, { status: 400 })

  const parsed = parseAdminPlayers(body.players)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const players = parsed.players.map(p => ({ ...p, name: sanitiseText(p.name), firstName: sanitiseText(p.firstName), lastName: sanitiseText(p.lastName) }))

  // The same address twice is the same person twice — a slip, not a request.
  const emails = players.flatMap(p => (p.email ? [p.email] : []))
  if (new Set(emails).size !== emails.length) {
    return NextResponse.json({ error: 'The same email is entered for two players.' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: course } = await admin
    .from('courses')
    .select('id, name, ghl_calendar_id, timezone, address, city, meeting_duration_mins, cost_per_player, max_players_per_day, playing_host_member_id')
    .eq('id', courseId)
    .single()
  if (!course) return NextResponse.json({ error: 'Venue not found.' }, { status: 404 })

  // Who each player is. Sequential: two new players can share a phone number,
  // and GHL de-duplicates contacts.
  const resolved: Resolved[] = []
  for (const player of players) {
    resolved.push(await resolvePlayer(admin, player))
  }

  const price = bookingAmountDue({ cost_per_player: course.cost_per_player })
  // Ids made here, so each GHL appointment below lands on its own player's
  // row without relying on the order the insert hands rows back in. One
  // insert, so the rows share a created_at and read as one group on the list.
  const ids = resolved.map(() => randomUUID())
  const rows = resolved.map((r, i) => ({
    id: ids[i],
    added_by_admin_id: ctx.userId,
    course_id: course.id,
    booking_date: date,
    tee_time: teeTime,
    players: 1,
    ...adminSeatOwnership(r.player, r.memberId, ctx.userId),
    status: PAY_AT_CLUB_BOOKING_STATUS,
    payment_method: PAY_AT_CLUB,
    amount_charged: price,
    paid_by_booker: false,
  }))

  const { data: inserted, error: insertError } = await admin
    .from('bookings')
    .insert(rows)
    .select('id')
  if (insertError || !inserted?.length) {
    logger.error('Admin add players: insert failed', {
      action: 'admin_bookings.add_players',
      errorMessage: insertError?.message ?? 'no rows',
    })
    return NextResponse.json({ error: 'Failed to add the players. Please try again.' }, { status: 500 })
  }

  const warnings = resolved.flatMap(r => (r.warning ? [r.warning] : []))
  const displayDate = format(new Date(`${date}T12:00:00`), 'EEEE, MMMM d')

  // The GHL calendar: one appointment per player with a contact.
  const calendarId = course.ghl_calendar_id as string | null
  if (calendarId) {
    const timezone = course.timezone || AVIARA_TIMEZONE
    const duration = await resolveMeetingDurationMins(
      calendarId,
      course.meeting_duration_mins || FALLBACK_ROUND_DURATION_MINUTES,
    )
    let appointment: { calendarId: string; title: string; startTime: string; endTime: string; timezone: string; address: string } | null = null
    try {
      const { startIso, endIso } = resolveAppointmentIso(date, teeTime, timezone, duration)
      appointment = {
        calendarId,
        title: `LinkUp @ ${course.name}`,
        startTime: startIso,
        endTime: endIso,
        timezone,
        address: course.address || course.city || AVIARA_ADDRESS,
      }
    } catch (err) {
      logger.error('Admin add players: invalid venue timezone', { action: 'admin_bookings.add_players', errorMessage: String(err) })
      warnings.push("This venue's timezone is misconfigured, so nobody was put on its GHL calendar.")
    }

    if (appointment) {
      const appt = appointment
      await Promise.all(
        resolved.map(async (r, i) => {
          const rowId = ids[i]
          if (!r.contactId || !rowId) return
          try {
            const ghlId = await createBooking({
              ...appt,
              contact: { id: r.contactId, email: r.player.email ?? '', phone: r.player.phone },
            })
            await admin.from('bookings').update({ ghl_booking_id: ghlId }).eq('id', rowId)
          } catch (err) {
            logger.warn('Admin add players: GHL appointment failed', {
              action: 'admin_bookings.add_players',
              errorMessage: String(err),
              metadata: { bookingId: rowId },
            })
            const reason = ghlReason(err)
            warnings.push(`${r.player.name} is on the tee time, but GHL didn't take the appointment${reason ? ` (GHL said: ${reason})` : ''}.`)
          }
        }),
      )

      // The venue's playing host goes out with the day's first foursome — the
      // same as when a member books. Never fails the request.
      await seatPlayingHost(admin, {
        courseId: course.id,
        hostMemberId: course.playing_host_member_id,
        bookingDate: date,
        teeTime,
        capacity: course.max_players_per_day ?? DEFAULT_MAX_PLAYERS_PER_DAY,
        appointment: appt,
      })
    }
  } else {
    warnings.push("This venue has no GHL calendar, so the seats aren't on one.")
  }

  // Everyone with an account hears about it; the reminders follow on their own.
  for (const memberId of new Set(resolved.flatMap(r => (r.memberId ? [r.memberId] : [])))) {
    void notifyMember(
      memberId,
      NotificationTemplates.bookingMadeForYou(course.name, displayDate, formatTeeTime(teeTime)),
    ).catch(() => {})
  }

  return NextResponse.json({ added: inserted.length, warnings })
}, { requireAdmin: true })

/**
 * GHL's own words for a refusal, shown to the admin so a seat that missed the
 * calendar says why — the server log isn't somewhere an admin can look.
 */
function ghlReason(err: unknown): string | null {
  if (!(err instanceof GHLError)) return null
  const body = err.context?.body as { message?: unknown } | undefined
  const msg = Array.isArray(body?.message) ? body.message.join('; ') : body?.message
  const status = err.context?.statusCode
  const text = typeof msg === 'string' && msg.trim() ? msg.trim() : null
  return text ? text.slice(0, 200) : typeof status === 'number' ? `error ${status}` : null
}

/**
 * Finds or makes the account and GHL contact for one player. Never throws: a
 * player who can't be set up is still seated, under their name.
 */
async function resolvePlayer(admin: Admin, player: AdminPlayer): Promise<Resolved> {
  const base = { player, memberId: null, contactId: null, warning: null }

  if (player.email) {
    // An account already holds this address — use it as it is. Its name,
    // phone and tags are GHL's to keep, not overwritten by what was typed here.
    const { data: matches } = await admin
      .from('members')
      .select('id, email, ghl_contact_id')
      .ilike('email', player.email)
      .limit(5)
    const existing = (matches ?? []).find(m => String(m.email ?? '').toLowerCase() === player.email)
    if (existing) {
      return {
        ...base,
        memberId: existing.id as string,
        contactId: (existing.ghl_contact_id as string | null) ?? null,
        warning: existing.ghl_contact_id ? null : `${player.name} has no GHL contact, so their seat isn't on the GHL calendar.`,
      }
    }

    // A new address: a GHL contact (or the one GHL already holds for it) and a
    // guest login, the same set-up a member's non-member guest gets.
    try {
      const provisioned = await provisionNonMemberGuest(
        { email: player.email, firstName: player.firstName, lastName: player.lastName, mobile: player.phone ?? '' },
        admin,
      )
      return {
        ...base,
        memberId: provisioned.memberId,
        contactId: provisioned.contactId,
        warning: provisioned.memberId ? null : `${player.name}'s app login couldn't be made yet; the nightly sync will retry.`,
      }
    } catch (err) {
      logger.warn('Admin add players: guest setup failed', { action: 'admin_bookings.add_players', errorMessage: String(err) })
      return { ...base, warning: `${player.name} is on the tee time, but GHL couldn't set them up, so the seat isn't on the GHL calendar.` }
    }
  }

  // No address: a contact from the name (and phone), so the seat is on the GHL
  // calendar. There's no login without an email, so no account to link.
  try {
    const contactId = await createContact({
      firstName: player.firstName,
      lastName: player.lastName,
      phone: player.phone,
    })
    return { ...base, contactId }
  } catch (err) {
    logger.warn('Admin add players: contact create failed', { action: 'admin_bookings.add_players', errorMessage: String(err) })
    return { ...base, warning: `${player.name} is on the tee time, but GHL wouldn't create a contact for them, so the seat isn't on the GHL calendar.` }
  }
}
