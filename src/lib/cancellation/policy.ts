// The cancellation policy: what giving up a seat costs, and when.
//
//   two days or more before the round   free
//   the day before                      50% of the seat's price
//   the day itself                      100%
//
// "Day" is the venue's calendar day, not a 24-hour count back from the tee
// time. That's how the policy is worded to members ("the day before", "on the
// day"), and it's the same day arithmetic the booking window already uses (see
// daysUntil in ../bookings/lead-time), so a round can't be "tomorrow" to one rule
// and "today" to the other.
//
// The tiers are percentages, applied to each seat's own price — the green fee
// written onto the booking row, or a hosted round's member price. A new event at
// a new price needs nothing from here.
//
// Pure and dependency-free beyond its siblings, like ../bookings/price: the
// confirm screen, the cancel dialog and the routes that charge the fee all read
// it, so the figure a member is shown and the figure they're charged are one
// rule.

import { bookingAmountDue, formatRoundPrice } from '@/lib/bookings/price'
import { daysUntil } from '@/lib/bookings/lead-time'

export interface CancellationTier {
  /** Applies when the round is this many days away or fewer. */
  daysBefore: number
  /** Share of the seat's price, 1–100. */
  percent: number
}

/** Nearest first. A round further away than the last tier is free to cancel. */
export const CANCELLATION_TIERS: readonly CancellationTier[] = [
  { daysBefore: 0, percent: 100 },
  { daysBefore: 1, percent: 50 },
]

/** The first day out that costs nothing — the day after the furthest tier. */
export const FREE_CANCELLATION_DAYS =
  Math.max(...CANCELLATION_TIERS.map(t => t.daysBefore)) + 1

export interface CancellationQuote {
  /** 0 when cancelling now is free. */
  percent: number
  /** In dollars, rounded to the cent. 0 when free. */
  amount: number
  /** The price the percentage was taken of. */
  price: number
}

const FREE: Omit<CancellationQuote, 'price'> = { percent: 0, amount: 0 }

/** Round to whole cents, guarding against float drift. */
const round2 = (n: number) => Math.round(n * 100) / 100

/** Dollars to the integer cents Stripe charges in. */
export function toCents(amount: number): number {
  return Math.round(amount * 100)
}

/**
 * Today's date at the venue, 'YYYY-MM-DD'.
 *
 * The policy is about the venue's calendar, so "today" has to be read there —
 * a member in another timezone cancelling at 11pm their time may already be on
 * the round's day.
 */
export function todayAtVenue(timezone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** The tier that applies to a round this many days away, or null when free. */
export function tierFor(days: number): CancellationTier | null {
  if (Number.isNaN(days)) return null
  return CANCELLATION_TIERS.find(t => days <= t.daysBefore) ?? null
}

/**
 * What cancelling a seat at this price costs today.
 *
 * An unreadable date is free. The booking window treats one as closed, because
 * refusing a booking is cheap to correct; charging a card is not.
 */
export function cancellationQuote(input: {
  price: number
  eventDate: string
  today: string
}): CancellationQuote {
  const price = Number.isFinite(input.price) && input.price > 0 ? input.price : 0
  const tier = tierFor(daysUntil(input.eventDate, input.today))
  if (!tier || price === 0) return { ...FREE, price }
  return { percent: tier.percent, amount: round2((price * tier.percent) / 100), price }
}

/**
 * The statuses of a seat the venue is holding — the ones the cancel button is
 * offered on. A request nobody has confirmed yet (awaiting approval, tentative)
 * costs nothing to withdraw, and a seat already cancelled or waitlisted holds
 * nothing to give up.
 */
export const FEE_BEARING_STATUSES = [
  'availability_confirmed',
  'payment_confirmed',
  'confirmed',
] as const

/**
 * Whether the policy covers this booking seat at all, whatever the date.
 *
 * It doesn't when the seat is:
 *   - booked before it existed (cancellation_policy_applies is false — see
 *     20261103000001), so the member never agreed to it;
 *   - not a seat the venue is holding (FEE_BEARING_STATUSES);
 *   - an invitation nobody has answered. Nobody has committed to that seat, and
 *     the invite-expiry cron releases it for free a few hours before the round
 *     anyway — charging for doing by hand what the app does on its own would be
 *     a fee for being early.
 *
 * The cancel dialog asks this before stating the policy, so a seat it can't
 * charge is never shown the tiers as if they applied.
 */
export function seatUnderPolicy(seat: {
  cancellation_policy_applies?: boolean | null
  status: string
  invite_status?: string | null
}): boolean {
  return (
    seat.cancellation_policy_applies === true &&
    (FEE_BEARING_STATUSES as readonly string[]).includes(seat.status) &&
    seat.invite_status !== 'pending'
  )
}

/** What cancelling this booking seat costs now — free outside the policy (seatUnderPolicy). */
export function seatCancellationQuote(
  seat: {
    cancellation_policy_applies?: boolean | null
    status: string
    invite_status?: string | null
    booking_date: string
    amount_charged?: number | string | null
  },
  course: { cost_per_player?: number | string | null; timezone?: string | null } | null | undefined,
  fallbackTimezone: string,
  now: Date = new Date(),
): CancellationQuote {
  const price = bookingAmountDue({
    amount_charged: seat.amount_charged,
    cost_per_player: course?.cost_per_player,
  })
  if (!seatUnderPolicy(seat)) return { ...FREE, price }
  return cancellationQuote({
    price,
    eventDate: seat.booking_date,
    today: todayAtVenue(course?.timezone || fallbackTimezone, now),
  })
}

/**
 * The policy in sentences, for the confirm screen and the payments page.
 *
 * Given a price, each line names what it comes to ("$75"); without one it
 * states the share, for a page that isn't about any one round.
 */
export function policyLines(price?: number): string[] {
  const share = (percent: number) =>
    price && price > 0
      ? `${formatRoundPrice(round2((price * percent) / 100))}${percent < 100 ? ` (${percent}%)` : ''}`
      : percent === 100
        ? 'the full price'
        : `${percent}% of the price`

  const lines = [`Free to cancel up to ${FREE_CANCELLATION_DAYS} days before the round.`]
  // Furthest first, so the lines read in the order the days arrive.
  for (const tier of [...CANCELLATION_TIERS].sort((a, b) => b.daysBefore - a.daysBefore)) {
    const when =
      tier.daysBefore === 0
        ? 'on the day of the round'
        : tier.daysBefore === 1
          ? 'the day before'
          : `${tier.daysBefore} days before`
    lines.push(`Cancelling ${when} costs ${share(tier.percent)}.`)
  }
  return lines
}
