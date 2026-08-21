import { format } from 'date-fns'
import { titleCaseName } from '@/lib/utils'
import { validateUUID } from '@/lib/validation'
import { bookingAmountDue } from './price'
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
  // What this row costs, so the payment banner can say what paying with credit
  // would cover. See bookingAmountDue.
  amount_due: number
}

type AdminClient = ReturnType<typeof createAdminClient>

function formatBookingDate(dateStr: string): string {
  return format(new Date(`${dateStr}T12:00:00`), 'EEEE, MMMM d')
}

// Builds the message shown when a member is blocked from booking because they
// (or a booking of theirs) still owe payment. `findPendingPaymentBookings`
// returns a member's own rounds AND rounds where they're the booker for a guest
// who hasn't paid AND rounds they were invited to — so the copy has to point at
// whoever actually owes, not blindly say "your booking".
export function pendingPaymentBlockMessage(
  bookings: PendingPaymentBooking[],
): string {
  const [first] = bookings
  if (!first) return ''

  if (bookings.length === 1) {
    const date = formatBookingDate(first.booking_date)
    // A guest the member added to a prior booking still owes their share.
    if (first.player_name !== 'You') {
      return `${titleCaseName(first.player_name)} has a payment due for the booking you made at ${first.course_name} on ${date}. It must be paid before you can book again.`
    }
    // The member was added to someone else's round and owes their own share.
    if (first.invited) {
      return first.booker_name
        ? `You have a payment due for the round ${titleCaseName(first.booker_name)} added you to at ${first.course_name} on ${date}. Please pay before booking again.`
        : `You have a payment due for a round you were added to at ${first.course_name} on ${date}. Please pay before booking again.`
    }
    // The member's own booking.
    return `You have a payment due for your booking at ${first.course_name} on ${date}. Please pay before booking again.`
  }

  // Multiple due. If any belong to a guest the member added, the payment isn't
  // necessarily theirs to make, so avoid "pay them" and say "resolve".
  const anyGuest = bookings.some((b) => b.player_name !== 'You')
  return anyGuest
    ? `You have ${bookings.length} payments due — including for players you've added. They must all be resolved before you can book again.`
    : `You have ${bookings.length} bookings with payment due. Please pay them before booking again.`
}

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
    .select('id, member_id, course_id, booking_date, tee_time, status, guest_name, player_member_id, amount_charged, booker:members!bookings_member_id_fkey(first_name, last_name), course:courses!bookings_course_id_fkey(name, payment_url, cost_per_player)')
    .or(`member_id.eq.${memberId},player_member_id.eq.${memberId}`)
    .in('status', UNPAID_BOOKING_STATUSES)
    .gte('booking_date', todayStr())
    .order('booking_date', { ascending: true })

  return (data ?? []).map((row) => {
    const course = row.course as unknown as { name: string; payment_url: string | null; cost_per_player: number | null } | null
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
      amount_due: bookingAmountDue({
        amount_charged: row.amount_charged,
        cost_per_player: course?.cost_per_player,
      }),
    }
  })
}

// Batch variant of the FIFO check, used when a booker adds fellow members to a
// group booking: returns the subset of `memberIds` that currently have at least
// one booking awaiting payment. Same rule and scope as
// findPendingPaymentBookings (status in UNPAID_BOOKING_STATUSES, upcoming rounds
// only, matched on either member_id or player_member_id), collapsed to a set of
// blocked ids so the caller can name the offenders without exposing anyone
// else's booking detail.
export async function findMembersWithPendingPayment(
  admin: AdminClient,
  memberIds: string[],
): Promise<Set<string>> {
  // Only keep well-formed UUIDs. These ids are string-interpolated into the
  // PostgREST `.or()` filter below, which Supabase does NOT escape — an id
  // containing PostgREST syntax (commas, `.gte.`, embedded resources) could
  // otherwise malform or broaden the query. Validating here protects every
  // caller (the check-guests query param and the booking-create path alike).
  const ids = [...new Set(memberIds)].filter(
    (id) => validateUUID(id, 'memberId').valid,
  )
  const blocked = new Set<string>()
  if (ids.length === 0) return blocked

  const orClause = ids
    .map((id) => `member_id.eq.${id},player_member_id.eq.${id}`)
    .join(',')

  const { data } = await admin
    .from('bookings')
    .select('member_id, player_member_id')
    .or(orClause)
    .in('status', UNPAID_BOOKING_STATUSES)
    .gte('booking_date', todayStr())

  const idSet = new Set(ids)
  for (const row of data ?? []) {
    if (row.member_id && idSet.has(row.member_id)) blocked.add(row.member_id)
    if (row.player_member_id && idSet.has(row.player_member_id)) {
      blocked.add(row.player_member_id)
    }
  }
  return blocked
}
