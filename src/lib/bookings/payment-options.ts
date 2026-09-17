// How a venue takes payment for a round.
//
// Two ways, set per course (courses.payment_options):
//
//   pay_now      the venue's online checkout (courses.payment_url). What every
//                course did before this existed, so it's the default — and the
//                only way credit can be spent, since a credit code is typed
//                into that checkout.
//   pay_at_club  the member settles with the club on the day. Choosing it marks
//                the booking (bookings.payment_method = 'pay_at_club'), which
//                takes the round off the member's "payment due" list — it
//                reads "Paid at club" from then on.
//
// Dependency-free on purpose, like ./price: the payment banner, the bookings
// card, the host event form and the routes that enforce these rules all read it.

export const PAYMENT_OPTIONS = ['pay_now', 'pay_at_club'] as const
export type PaymentOption = (typeof PAYMENT_OPTIONS)[number]

/** What a course offers when it hasn't said — the behaviour before options existed. */
export const DEFAULT_PAYMENT_OPTIONS: readonly PaymentOption[] = ['pay_now']

export const PAYMENT_OPTION_LABELS: Record<PaymentOption, string> = {
  pay_now: 'Pay now',
  pay_at_club: 'Pay at club',
}

export const PAYMENT_OPTION_HINTS: Record<PaymentOption, string> = {
  pay_now: "Members pay online through the venue's checkout.",
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

/** Whether a booking row has been marked as settled at the club. */
export const isPaidAtClub = (row: { payment_method?: string | null } | null | undefined) =>
  row?.payment_method === PAY_AT_CLUB
