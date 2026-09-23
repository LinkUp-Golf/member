// How a venue takes payment for a round.
//
// Two ways, set per course (courses.payment_options):
//
//   pay_now      "Pay on App" — the checkout LinkUp sends a member to
//                (courses.payment_url). What every course did before this
//                existed, so it's the default — and the only way credit can be
//                spent, since a credit code is typed into that checkout.
//   pay_at_club  the member settles with the club on the day. Choosing it marks
//                the booking (bookings.payment_method = 'pay_at_club'), which
//                takes the round off the member's "payment due" list. It reads
//                "Paying at club" until the payment is confirmed, then "Paid at
//                club" — see payAtClubStage.
//
// Dependency-free on purpose, like ./price: the payment banner, the bookings
// card, the host event form and the routes that enforce these rules all read it.

export const PAYMENT_OPTIONS = ['pay_now', 'pay_at_club'] as const
export type PaymentOption = (typeof PAYMENT_OPTIONS)[number]

/** What a course offers when it hasn't said — the behaviour before options existed. */
export const DEFAULT_PAYMENT_OPTIONS: readonly PaymentOption[] = ['pay_now']

/**
 * What a venue a host brings to LinkUp is set up as.
 *
 * A host's round is settled with the club on the day: there is no checkout to
 * send anyone to at a club we've only just heard of, and the host is the one
 * standing there when the members arrive. So the hosting forms don't ask — they
 * state it — and this is the answer they send.
 */
export const HOST_DEFAULT_PAYMENT_OPTIONS: readonly PaymentOption[] = ['pay_at_club']

export const PAYMENT_OPTION_LABELS: Record<PaymentOption, string> = {
  pay_now: 'Pay on App',
  pay_at_club: 'Pay at club',
}

export const PAYMENT_OPTION_HINTS: Record<PaymentOption, string> = {
  // Who the money reaches, not which page it's typed into. The member's side of
  // this is one payment to LinkUp; the venue is paid once, for everyone.
  pay_now: 'Members pay LinkUp. LinkUp makes aggregate payment to host.',
  pay_at_club: 'Members settle with the club on the day.',
}

/** The one alternative payment method a booking records. null = the checkout. */
export const PAY_AT_CLUB = 'pay_at_club' as const

/**
 * A course's options, in canonical order, falling back to the default for a row
 * read before the column existed (or a response that didn't select it).
 */
export function coursePaymentOptions(
  course: { payment_options?: readonly string[] | null } | null | undefined,
): PaymentOption[] {
  const parsed = parsePaymentOptions(course?.payment_options)
  return parsed ?? [...DEFAULT_PAYMENT_OPTIONS]
}

export const offersPayNow = (
  course: { payment_options?: readonly string[] | null } | null | undefined,
) => coursePaymentOptions(course).includes('pay_now')

export const offersPayAtClub = (
  course: { payment_options?: readonly string[] | null } | null | undefined,
) => coursePaymentOptions(course).includes('pay_at_club')

/**
 * Validates options arriving off the wire. Returns them de-duplicated and in
 * canonical order, or null when the value isn't a non-empty list of known
 * options — a course has to be payable somehow.
 */
export function parsePaymentOptions(value: unknown): PaymentOption[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  if (!value.every((v): v is PaymentOption => (PAYMENT_OPTIONS as readonly unknown[]).includes(v))) {
    return null
  }
  return PAYMENT_OPTIONS.filter((o) => value.includes(o))
}

/** Whether the member chose to settle this booking at the club — paid or not yet. */
export const isPayAtClub = (row: { payment_method?: string | null } | null | undefined) =>
  row?.payment_method === PAY_AT_CLUB

/** Statuses that mean a round's payment has come in. */
const PAYMENT_RECEIVED_STATUSES: readonly string[] = ['payment_confirmed', 'confirmed']
/** Statuses where the round isn't going ahead, so there's nothing to settle. */
const NOT_GOING_AHEAD_STATUSES: readonly string[] = ['cancelled', 'waitlist']

export type PayAtClubStage = 'paying' | 'paid'

export const PAY_AT_CLUB_STAGE_LABELS: Record<PayAtClubStage, string> = {
  paying: 'Paying at club',
  paid: 'Paid at club',
}

/**
 * Where a pay-at-club booking has got to: 'paying' until its payment is
 * confirmed — choosing to pay at the club isn't paying — then 'paid'. null for a
 * booking not being settled at the club, or one that isn't going ahead.
 */
export function payAtClubStage(
  row: { status: string; payment_method?: string | null } | null | undefined,
): PayAtClubStage | null {
  if (!row || !isPayAtClub(row)) return null
  if (PAYMENT_RECEIVED_STATUSES.includes(row.status)) return 'paid'
  if (NOT_GOING_AHEAD_STATUSES.includes(row.status)) return null
  return 'paying'
}
