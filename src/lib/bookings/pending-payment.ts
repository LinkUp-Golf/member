import type { createAdminClient } from '@/lib/supabase-server'

// Only 'availability_confirmed' — GHL has confirmed the slot and a payment
// link has been sent — counts as "payment due" for FIFO purposes. Earlier
// stages ('tentative', 'awaiting_approval') aren't blocking: nothing is
// owed yet, since there's no payment link to act on until availability is
// confirmed. LinkUp allows a member to hold at most one round awaiting
// payment at a time — they must pay (or have it cancelled) before they can
// book another, at any course.
export const UNPAID_BOOKING_STATUSES = ['availability_confirmed'] as const

export interface PendingPaymentBooking {
  id: string
  course_id: string
  course_name: string
  booking_date: string
  tee_time: string
  payment_url: string | null
  status: string
  // Whose round this specific row's payment is for. Each player in a group
  // booking gets their own GHL appointment and moves through the payment
  // pipeline independently, so different rows in the same group can be at
  // different stages — "You" for the querying member's own row, otherwise
  // the guest's name captured at booking time.
  player_name: string
  // The guest's member ID, when player_name refers to a fellow LinkUp
  // member the querying member booked for (so the UI can offer to message
  // them) — null for the querying member's own rows and for non-member
  // guests, who have no account to message.
  target_member_id: string | null
  // True when the querying member is an *invited* player on someone else's
  // booking (they were added by the booker) rather than the booker themselves.
  // Lets the UI explain that they were invited and owe their share, instead of
  // the booker-facing "before booking another" wording.
  invited: boolean
  // Name of the member who booked this round, shown when `invited` so the
  // added player can see who invited them. Null otherwise.
  booker_name: string | null
}

type AdminClient = ReturnType<typeof createAdminClient>

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

// Returns every one of a member's bookings currently awaiting payment,
// oldest first.
//
// This is a list rather than a single row because the FIFO rule is being
// added to an app already in production: some members already have more
// than one booking awaiting payment on their account from before the rule
// existed (across different courses), and all of them need to be surfaced
// and resolved — not just the oldest one — before the member can book
// again.
//
// Scoped to booking_date >= today: a payment is only "due" for an upcoming
// round. Once a tee time has passed there's nothing to pay to confirm, so a
// past booking never counts toward the badge/banner or the FIFO booking gate
// (which also keeps a stale, never-resolved booking from permanently locking
// a member out of booking).
export async function findPendingPaymentBookings(
  admin: AdminClient,
  memberId: string,
): Promise<PendingPaymentBooking[]> {
  const { data } = await admin
    .from('bookings')
    .select('id, member_id, course_id, booking_date, tee_time, status, guest_name, player_member_id, booker:members!bookings_member_id_fkey(first_name, last_name), course:courses!bookings_course_id_fkey(name, payment_url)')
    .or(`member_id.eq.${memberId},player_member_id.eq.${memberId}`)
    .in('status', UNPAID_BOOKING_STATUSES)
    .gte('booking_date', todayStr())
    .order('booking_date', { ascending: true })

  return (data ?? []).map((row) => {
    const course = row.course as unknown as { name: string; payment_url: string | null } | null
    // The querying member's own round is either their primary row (no guest
    // name) or one where they were the invited player, regardless of who
    // booked it.
    const isOwnRound = row.player_member_id === memberId || !row.guest_name
    // Invited: the querying member is the added player on someone else's
    // booking — they didn't book it (member_id is the booker), they were
    // invited into it (player_member_id points at them).
    const invited = row.member_id !== memberId && row.player_member_id === memberId
    const booker = row.booker as unknown as { first_name: string | null; last_name: string | null } | null
    const bookerName = booker
      ? `${booker.first_name ?? ''} ${booker.last_name ?? ''}`.trim() || null
      : null
    return {
      id: row.id,
      course_id: row.course_id,
      course_name: course?.name ?? 'your course',
      booking_date: row.booking_date,
      tee_time: row.tee_time,
      payment_url: course?.payment_url ?? null,
      status: row.status,
      player_name: isOwnRound ? 'You' : (row.guest_name as string),
      target_member_id: isOwnRound ? null : row.player_member_id,
      invited,
      booker_name: invited ? bookerName : null,
    }
  })
}
