import { describe, it, expect } from 'vitest'
import {
  couponSettlementOutcome,
  creditCouponAmount,
  generateCouponCode,
  isCouponUsable,
} from '@/lib/credits'
import { bookingAmountDue } from '@/lib/bookings/price'
import { isDuplicateCouponCodeError } from '@/lib/ghl/coupons'
import { GHLError, ErrorCode } from '@/lib/errors/app-error'
import {
  BOOKING_PRICE_USD,
  CREDIT_COUPON_CODE_ALPHABET,
  CREDIT_COUPON_CODE_LENGTH,
  CREDIT_COUPON_CODE_PREFIX,
} from '@/lib/constants'

describe('creditCouponAmount', () => {
  it('covers the whole bill when the balance can', () => {
    expect(creditCouponAmount({ balance: 300, price: 160 }))
      .toEqual({ ok: true, amount: 160 })
  })

  it('never exceeds the bill — the excess would be thrown away at checkout', () => {
    expect(creditCouponAmount({ balance: 300, price: 40, requested: 300 }))
      .toEqual({ ok: true, amount: 40 })
  })

  it('refuses a bill the balance cannot cover, rather than part-paying it', () => {
    // A code worth less than the round fails at the till, so the member keeps
    // the credit until it's worth something here.
    expect(creditCouponAmount({ balance: 55, price: 160 }))
      .toEqual({ ok: false, reason: 'short', shortfall: 105 })
  })

  it('treats an exact balance as covering the bill', () => {
    expect(creditCouponAmount({ balance: 160, price: 160 }))
      .toEqual({ ok: true, amount: 160 })
    // A cent short is short.
    expect(creditCouponAmount({ balance: 159.99, price: 160 }))
      .toEqual({ ok: false, reason: 'short', shortfall: 0.01 })
  })

  it('ignores a smaller requested amount on a bill — the code is the bill', () => {
    expect(creditCouponAmount({ balance: 300, price: 160, requested: 50 }))
      .toEqual({ ok: true, amount: 160 })
  })

  it('caps a wallet conversion at the balance', () => {
    expect(creditCouponAmount({ balance: 80, requested: 200 }))
      .toEqual({ ok: true, amount: 80 })
    // No bill and no amount asked for: the whole balance.
    expect(creditCouponAmount({ balance: 80 })).toEqual({ ok: true, amount: 80 })
  })

  it('refuses an empty wallet, and reports the bill as the shortfall', () => {
    expect(creditCouponAmount({ balance: 0, price: 160 }))
      .toEqual({ ok: false, reason: 'empty', shortfall: 160 })
    expect(creditCouponAmount({ balance: -20, price: 160 }))
      .toEqual({ ok: false, reason: 'empty', shortfall: 160 })
    expect(creditCouponAmount({ balance: 0 }))
      .toEqual({ ok: false, reason: 'empty', shortfall: 0 })
  })

  it('keeps cents clean', () => {
    const sized = creditCouponAmount({ balance: 0.3, price: 0.1 + 0.2 })
    expect(sized).toEqual({ ok: true, amount: 0.3 })
  })
})

describe('generateCouponCode', () => {
  it('is letters and numbers only — GHL rejects anything else with a 422', () => {
    // "Coupon code can only contain letters and numbers". A separator between
    // the prefix and the random part made every code unusable, so this is the
    // test that has to hold whatever else changes about the format.
    for (let i = 0; i < 25; i++) {
      expect(generateCouponCode()).toMatch(/^[A-Z0-9]+$/)
    }
  })

  it('is the prefix plus characters from the unambiguous alphabet', () => {
    const code = generateCouponCode()
    expect(code.startsWith(CREDIT_COUPON_CODE_PREFIX)).toBe(true)
    const random = code.slice(CREDIT_COUPON_CODE_PREFIX.length)
    expect(random).toHaveLength(CREDIT_COUPON_CODE_LENGTH)
    for (const ch of random) expect(CREDIT_COUPON_CODE_ALPHABET).toContain(ch)
  })

  it('has no look-alike characters to mistype', () => {
    for (const ch of ['O', '0', 'I', '1', 'S', '5']) {
      expect(CREDIT_COUPON_CODE_ALPHABET).not.toContain(ch)
    }
  })

  it('maps bytes deterministically when randomness is supplied', () => {
    const zeros = (n: number) => new Uint8Array(n).fill(0)
    const first = CREDIT_COUPON_CODE_ALPHABET.charAt(0)
    expect(generateCouponCode(zeros)).toBe(
      `${CREDIT_COUPON_CODE_PREFIX}${first.repeat(CREDIT_COUPON_CODE_LENGTH)}`
    )

    // Wraps around the alphabet rather than falling off the end.
    const wrap = (n: number) => new Uint8Array(n).fill(CREDIT_COUPON_CODE_ALPHABET.length)
    expect(generateCouponCode(wrap)).toBe(
      `${CREDIT_COUPON_CODE_PREFIX}${first.repeat(CREDIT_COUPON_CODE_LENGTH)}`
    )
  })

  it('varies between calls', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateCouponCode()))
    expect(codes.size).toBeGreaterThan(45)
  })
})

describe('couponSettlementOutcome', () => {
  const now = new Date('2026-08-22T12:00:00Z')
  const future = '2026-09-22T12:00:00Z'
  const past = '2026-08-01T12:00:00Z'

  it('settles a used code as redeemed', () => {
    expect(couponSettlementOutcome({
      ghl: { status: 'active', usageCount: 1 }, expiresAt: future, now,
    })).toBe('redeemed')
  })

  it('settles an unused code past its date as expired', () => {
    expect(couponSettlementOutcome({
      ghl: { status: 'active', usageCount: 0 }, expiresAt: past, now,
    })).toBe('expired')
    // GHL's own verdict counts too, even inside our window.
    expect(couponSettlementOutcome({
      ghl: { status: 'expired', usageCount: 0 }, expiresAt: future, now,
    })).toBe('expired')
  })

  it('leaves a live, unused code alone', () => {
    expect(couponSettlementOutcome({
      ghl: { status: 'active', usageCount: 0 }, expiresAt: future, now,
    })).toBeNull()
  })

  it('never lapses a code with no end date — the way they are issued now', () => {
    // Nothing sweeps these up: a code ends by being used or refunded.
    expect(couponSettlementOutcome({
      ghl: { status: 'active', usageCount: 0 }, expiresAt: null, now,
    })).toBeNull()
    // Even if GHL itself calls it expired, there is no date to have passed.
    expect(couponSettlementOutcome({
      ghl: { status: 'expired', usageCount: 0 }, expiresAt: null, now,
    })).toBe('expired')
    // Used is still used.
    expect(couponSettlementOutcome({
      ghl: { status: 'active', usageCount: 1 }, expiresAt: null, now,
    })).toBe('redeemed')
  })

  it('still voids a no-expiry code that never reached GHL', () => {
    // Otherwise this credit would be debited against nothing, forever — with no
    // expiry left to catch it.
    expect(couponSettlementOutcome({
      ghl: null, hadGhlId: false, expiresAt: null, now,
    })).toBe('void')
    // Had an id, so it existed once: leave it, since there's no date to judge it
    // by and it may have been used before someone deleted it.
    expect(couponSettlementOutcome({
      ghl: null, hadGhlId: true, expiresAt: null, now,
    })).toBeNull()
  })

  it('prefers redeemed over expired — a used code is spent, not refundable', () => {
    expect(couponSettlementOutcome({
      ghl: { status: 'expired', usageCount: 1 }, expiresAt: past, now,
    })).toBe('redeemed')
  })

  it('voids a code that never reached GHL, so its credit is not stranded', () => {
    // No id was ever recorded: the create call failed after the wallet was
    // debited. Nothing could have been redeemed with it.
    expect(couponSettlementOutcome({ ghl: null, hadGhlId: false, expiresAt: future, now })).toBe('void')
    expect(couponSettlementOutcome({ ghl: null, hadGhlId: false, expiresAt: past, now })).toBe('void')
  })

  it('waits for expiry on a code GHL had and no longer has', () => {
    // It existed, so it may have been used before being deleted by hand —
    // leave it until its own date passes.
    expect(couponSettlementOutcome({ ghl: null, hadGhlId: true, expiresAt: future, now })).toBeNull()
    expect(couponSettlementOutcome({ ghl: null, hadGhlId: true, expiresAt: past, now })).toBe('expired')
  })
})

describe('isCouponUsable', () => {
  const now = new Date('2026-08-22T12:00:00Z')

  it('is true for an issued code with no end date', () => {
    expect(isCouponUsable({ status: 'issued', expires_at: null }, now)).toBe(true)
    expect(isCouponUsable({ status: 'redeemed', expires_at: null }, now)).toBe(false)
    expect(isCouponUsable({ status: 'void', expires_at: null }, now)).toBe(false)
  })

  it('still honours a legacy window when one was stored', () => {
    expect(isCouponUsable({ status: 'issued', expires_at: '2026-09-01T00:00:00Z' }, now)).toBe(true)
    expect(isCouponUsable({ status: 'issued', expires_at: '2026-08-01T00:00:00Z' }, now)).toBe(false)
    expect(isCouponUsable({ status: 'redeemed', expires_at: '2026-09-01T00:00:00Z' }, now)).toBe(false)
  })
})

describe('bookingAmountDue', () => {
  it('uses what the booking was written for', () => {
    expect(bookingAmountDue({ amount_charged: 185 })).toBe(185)
    // Numerics come back from PostgREST as strings.
    expect(bookingAmountDue({ amount_charged: '185.50' })).toBe(185.5)
  })

  it('falls back to the venue rate, then the house price', () => {
    expect(bookingAmountDue({ amount_charged: 0, cost_per_player: 210 })).toBe(210)
    expect(bookingAmountDue({ amount_charged: 0 })).toBe(BOOKING_PRICE_USD)
    expect(bookingAmountDue({})).toBe(BOOKING_PRICE_USD)
    expect(bookingAmountDue({ amount_charged: null, cost_per_player: null })).toBe(BOOKING_PRICE_USD)
  })
})

// The two 422s GHL actually returns, recorded from live calls. They differ in
// shape — one message is a string, the other an array — and only one of them
// means "try another code".
describe('isDuplicateCouponCodeError', () => {
  const ghlError = (body: unknown) =>
    new GHLError('GHL API error 422', ErrorCode.GHL_UNAVAILABLE, { statusCode: 422, body })

  it('recognises a code GHL already has', () => {
    expect(isDuplicateCouponCodeError(ghlError({
      status: 422, message: 'Coupon code is already in use', name: 'HttpException',
    }))).toBe(true)
  })

  it('does not mistake a rejected code format for a clash', () => {
    // Retrying this one would just fail again with a different random code.
    expect(isDuplicateCouponCodeError(ghlError({
      status: 422, message: ['Coupon code can only contain letters and numbers'],
      name: 'UnprocessableEntityException',
    }))).toBe(false)
  })

  it('is false for anything that is not a GHL failure', () => {
    expect(isDuplicateCouponCodeError(new Error('network down'))).toBe(false)
    expect(isDuplicateCouponCodeError(ghlError(undefined))).toBe(false)
    expect(isDuplicateCouponCodeError(null)).toBe(false)
  })
})
