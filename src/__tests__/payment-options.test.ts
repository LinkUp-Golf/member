import { describe, it, expect } from 'vitest'
import { NEW_BOOKING_STATUS, PAY_AT_CLUB_BOOKING_STATUS } from '@/lib/constants'
import { UNPAID_BOOKING_STATUSES } from '@/lib/bookings/pending-payment'
import {
  canTakePayment,
  coursePaymentOptions,
  isPayAtClub,
  offersPayAtClub,
  offersPayNow,
  parsePaymentOptions,
  payAtClubStage,
  requiresPaymentUrl,
} from '@/lib/bookings/payment-options'

// A venue's payment options decide which CTAs a member sees and what the
// routes will accept. These lock the two rules that keep a venue payable: the
// default is the checkout every course used before options existed, and a set
// arriving off the wire has to be non-empty and known.

describe('coursePaymentOptions', () => {
  it('defaults to Pay on App when the course carries no options', () => {
    expect(coursePaymentOptions(null)).toEqual(['pay_now'])
    expect(coursePaymentOptions({})).toEqual(['pay_now'])
    expect(coursePaymentOptions({ payment_options: null })).toEqual(['pay_now'])
    expect(coursePaymentOptions({ payment_options: [] })).toEqual(['pay_now'])
  })

  it('returns what the course offers, in canonical order', () => {
    expect(coursePaymentOptions({ payment_options: ['pay_at_club', 'pay_now'] })).toEqual([
      'pay_now',
      'pay_at_club',
    ])
    expect(coursePaymentOptions({ payment_options: ['pay_at_club'] })).toEqual(['pay_at_club'])
  })

  it('answers which CTAs a venue gets', () => {
    const clubOnly = { payment_options: ['pay_at_club'] }
    expect(offersPayNow(clubOnly)).toBe(false)
    expect(offersPayAtClub(clubOnly)).toBe(true)
    // A row read before the column existed still gets the checkout.
    expect(offersPayNow({})).toBe(true)
    expect(offersPayAtClub({})).toBe(false)
  })
})

describe('parsePaymentOptions', () => {
  it('refuses an empty or non-list value — a course has to be payable', () => {
    expect(parsePaymentOptions([])).toBeNull()
    expect(parsePaymentOptions(undefined)).toBeNull()
    expect(parsePaymentOptions('pay_now')).toBeNull()
  })

  it('refuses anything outside the known options', () => {
    expect(parsePaymentOptions(['pay_now', 'cash'])).toBeNull()
  })

  it('de-duplicates and orders a valid set', () => {
    expect(parsePaymentOptions(['pay_at_club', 'pay_now', 'pay_at_club'])).toEqual([
      'pay_now',
      'pay_at_club',
    ])
  })
})

describe('isPayAtClub', () => {
  it('is true only for a row marked pay_at_club', () => {
    expect(isPayAtClub({ payment_method: 'pay_at_club' })).toBe(true)
    expect(isPayAtClub({ payment_method: null })).toBe(false)
    expect(isPayAtClub({})).toBe(false)
    expect(isPayAtClub(null)).toBe(false)
  })
})

describe('payAtClubStage', () => {
  const club = (status: string) => ({ status, payment_method: 'pay_at_club' })

  it("reads 'paying' until the payment is confirmed — choosing the club isn't paying", () => {
    expect(payAtClubStage(club('availability_confirmed'))).toBe('paying')
    expect(payAtClubStage(club('tentative'))).toBe('paying')
  })

  it("reads 'paid' once the payment is confirmed", () => {
    expect(payAtClubStage(club('payment_confirmed'))).toBe('paid')
    expect(payAtClubStage(club('confirmed'))).toBe('paid')
  })

  it('says nothing for a round that is not going ahead, or not paid at the club', () => {
    expect(payAtClubStage(club('cancelled'))).toBeNull()
    expect(payAtClubStage({ status: 'payment_confirmed', payment_method: null })).toBeNull()
    expect(payAtClubStage(null)).toBeNull()
  })
})

// Whether a venue needs a payment link, and whether it can be paid at all. The
// admin course form, POST and PATCH /api/admin/courses, course approval and the
// four member-facing venue queries all decide it from here, so these are the
// rules behind "saved without a link" and "listed to members".
describe('requiresPaymentUrl', () => {
  it('needs a link wherever Pay on App is offered, including alongside pay at club', () => {
    expect(requiresPaymentUrl({ payment_options: ['pay_now'] })).toBe(true)
    expect(requiresPaymentUrl({ payment_options: ['pay_now', 'pay_at_club'] })).toBe(true)
    // No options recorded means the default, which is Pay on App.
    expect(requiresPaymentUrl({})).toBe(true)
    expect(requiresPaymentUrl(null)).toBe(true)
  })

  it('needs none where the round is settled at the club', () => {
    expect(requiresPaymentUrl({ payment_options: ['pay_at_club'] })).toBe(false)
  })
})

describe('canTakePayment', () => {
  it('passes a pay-at-club venue with no link at all', () => {
    expect(canTakePayment({ payment_options: ['pay_at_club'], payment_url: null })).toBe(true)
    expect(canTakePayment({ payment_options: ['pay_at_club'] })).toBe(true)
  })

  it('fails a Pay on App venue with nowhere to pay', () => {
    expect(canTakePayment({ payment_options: ['pay_now'], payment_url: null })).toBe(false)
    // Blank and whitespace are no link, not a short one.
    expect(canTakePayment({ payment_options: ['pay_now'], payment_url: '' })).toBe(false)
    expect(canTakePayment({ payment_options: ['pay_now'], payment_url: '   ' })).toBe(false)
    expect(canTakePayment({ payment_url: null })).toBe(false)
    expect(canTakePayment(null)).toBe(false)
  })

  it('passes once the checkout exists', () => {
    const url = 'https://linkupgolf-services.com/checkout'
    expect(canTakePayment({ payment_options: ['pay_now'], payment_url: url })).toBe(true)
    expect(canTakePayment({ payment_options: ['pay_now', 'pay_at_club'], payment_url: url })).toBe(
      true,
    )
  })

  it('still requires the link when both options are on — the Pay button needs one', () => {
    expect(
      canTakePayment({ payment_options: ['pay_now', 'pay_at_club'], payment_url: null }),
    ).toBe(false)
  })
})

// What a round opens at, and the invariant that makes it safe. A venue with no
// checkout has nothing for the app to collect, so POST /api/bookings/create (and
// the add-players route) open the round already confirmed — which only works
// while that status is one the payment banner ignores.
describe('PAY_AT_CLUB_BOOKING_STATUS', () => {
  it('is never on the payment banner — nothing is owed through the app', () => {
    expect(UNPAID_BOOKING_STATUSES).not.toContain(PAY_AT_CLUB_BOOKING_STATUS)
    // The ordinary status is, which is the whole point of the distinction.
    expect(UNPAID_BOOKING_STATUSES).toContain(NEW_BOOKING_STATUS)
  })

  it('reads as settled at the club once the round carries both halves', () => {
    const round = { status: PAY_AT_CLUB_BOOKING_STATUS, payment_method: 'pay_at_club' }
    expect(isPayAtClub(round)).toBe(true)
    expect(payAtClubStage(round)).toBe('paid')
  })

  it("leaves a round the member chose the club for reading as in progress", () => {
    // A venue that takes both keeps NEW_BOOKING_STATUS; only the method changes,
    // so the two cases stay distinguishable on screen.
    const chosen = { status: NEW_BOOKING_STATUS, payment_method: 'pay_at_club' }
    expect(payAtClubStage(chosen)).toBe('paying')
  })
})
