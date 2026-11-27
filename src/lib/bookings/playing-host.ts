// The playing host: one member who plays in the first foursome of every day at
// a venue — Greg Lipper at Park Hyatt Aviara (2026-11-27).
//
// It replaced the "Host" line the Who's-playing sheet used to draw from the
// venue's GHL calendar user. At Aviara that was "Greg 2", a GHL user who isn't a
// member and doesn't play, shown at the head of every tee time. What actually
// happens is that one person goes out with the first group of the day, and only
// that group — so the host is now a real booking row in that group: it holds one
// of the four seats (members see 3 open, a fifth can't book in), it's free, and
// it's never chased for payment.
//
// The rules, all decided with Greg:
//   * The seat is placed when the day's first booking is made, in that booking's
//     tee time. The app only learns a day exists when someone books it.
//   * Once placed it stays. A member who later books an earlier tee time doesn't
//     move the host; the admin can.
//   * It's decided once per venue-day (`playing_host_days`). An admin who removes
//     the host, or replaces them with someone else (Replace on /admin/bookings),
//     isn't overruled by the next booking that day.
//   * A host who already holds a seat that day (booked it, or was added) isn't
//     given a second.
//   * A first foursome booked full leaves the day undecided, so the host goes
//     out with the next foursome booked that day instead.
//
// The venue's host is `courses.playing_host_member_id`; the seat is
// `bookings.playing_host`. The atomic part — the lock, the day ledger, the
// capacity checks and the insert — is the `seat_playing_host` SQL function.

import { createBooking, getCalendarBookingRules } from '@/lib/ghl/client'
import { logger } from '@/lib/logger'
import type { createAdminClient } from '@/lib/supabase-server'

type AdminClient = ReturnType<typeof createAdminClient>

/** What's needed to put the host's appointment on the venue's GHL calendar. */
export interface HostAppointment {
  calendarId: string
  title: string
  startTime: string
  endTime: string
  timezone: string
  address: string
}

/**
 * Whether a venue's tee sheet should still draw the calendar's GHL user as
 * "Host". Not where the venue has a playing host: they're on the sheet as a
 * player in the foursome they're actually in, and the calendar user isn't
 * somebody who plays.
 */
export function showsCalendarHost(course: { playing_host_member_id?: string | null }): boolean {
  return !course.playing_host_member_id
}

/**
 * Seats the venue's playing host in the tee time just booked, if the day needs
 * them. Never throws and never fails the booking that called it: the member's
 * round is made either way, and an admin can add the host by hand.
 *
 * Returns the new seat's id, or null when nobody was seated.
 */
export async function seatPlayingHost(
  admin: AdminClient,
  args: {
    courseId: string
    hostMemberId: string | null | undefined
    bookingDate: string
    teeTime: string
    capacity: number
    appointment: HostAppointment
  },
): Promise<string | null> {
  const { courseId, hostMemberId, bookingDate, teeTime, capacity, appointment } = args
  if (!hostMemberId) return null

  try {
    const rules = await getCalendarBookingRules(appointment.calendarId)
    const { data, error } = await admin.rpc('seat_playing_host', {
      p_course_id: courseId,
      p_date: bookingDate,
      p_tee_time: teeTime,
      p_member_id: hostMemberId,
      p_capacity: capacity,
      p_seats_per_slot: rules?.seatsPerSlot ?? null,
    })
    if (error) throw new Error(error.message)

    const seat = (data as Array<{ id: string }> | null)?.[0]
    if (!seat) return null

    // The seat is held on our side; now the appointment on GHL's, so the
    // calendar's own seat count agrees. Best-effort, like a guest's: the seat
    // stands without it, and an admin can see it's missing.
    const { data: host } = await admin
      .from('members')
      .select('ghl_contact_id, email, phone')
      .eq('id', hostMemberId)
      .single()
    if (host?.ghl_contact_id) {
      try {
        const ghlId = await createBooking({
          ...appointment,
          contact: { id: host.ghl_contact_id, email: host.email, phone: host.phone ?? null },
        })
        await admin.from('bookings').update({ ghl_booking_id: ghlId }).eq('id', seat.id)
      } catch (err) {
        logger.warn('Playing host seated, but their GHL appointment failed', {
          action: 'playing_host.ghl_failed',
          errorMessage: String(err),
          metadata: { bookingId: seat.id, courseId, bookingDate },
        })
      }
    }

    logger.info('Playing host seated', {
      action: 'playing_host.seated',
      metadata: { bookingId: seat.id, courseId, bookingDate, teeTime },
    })
    return seat.id
  } catch (err) {
    logger.error('Could not seat the playing host', {
      action: 'playing_host.failed',
      errorMessage: String(err),
      metadata: { courseId, bookingDate, teeTime },
    })
    return null
  }
}
