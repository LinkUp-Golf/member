import { describe, it, expect } from 'vitest'
import {
  coursePaymentOptions,
  isPayAtClub,
  offersPayAtClub,
  offersPayNow,
  parsePaymentOptions,
  payAtClubStage,
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
