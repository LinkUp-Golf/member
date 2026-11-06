import { describe, it, expect } from 'vitest'
import {
  cancellationQuote,
  FREE_CANCELLATION_DAYS,
  policyLines,
  seatCancellationQuote,
  seatUnderPolicy,
  toCents,
  todayAtVenue,
} from '@/lib/cancellation/policy'
import { cardExpiry, cardFromRow, cardInUseMessage, cardLabel } from '@/lib/stripe/card'

// Giving up a seat late costs a share of its own price: half the day before,
// all of it on the day. The confirm screen quotes it, the cancel dialog quotes
// it again, and the cancel route charges it — three readers of one rule, so a
// member is never charged a figure they weren't shown.

describe('cancellationQuote', () => {
  const quote = (eventDate: string, today: string, price = 150) =>
    cancellationQuote({ price, eventDate, today })

  it('charges half the day before', () => {
    expect(quote('2026-11-08', '2026-11-07')).toEqual({ percent: 50, amount: 75, price: 150 })
  })

  it('charges everything on the day', () => {
    expect(quote('2026-11-08', '2026-11-08')).toEqual({ percent: 100, amount: 150, price: 150 })
  })

  it('is free two days out and beyond', () => {
    expect(FREE_CANCELLATION_DAYS).toBe(2)
    expect(quote('2026-11-08', '2026-11-06').amount).toBe(0)
    expect(quote('2026-11-30', '2026-11-06').amount).toBe(0)
  })

  it('scales with each event’s own price', () => {
    expect(quote('2026-11-08', '2026-11-07', 300).amount).toBe(150)
    expect(quote('2026-11-08', '2026-11-07', 160).amount).toBe(80)
  })

  it('keeps cents where the price has them', () => {
    expect(quote('2026-11-08', '2026-11-07', 175.5).amount).toBe(87.75)
    expect(quote('2026-11-08', '2026-11-07', 99.99).amount).toBe(50)
    expect(toCents(87.75)).toBe(8775)
  })

  it('counts calendar days across a DST change', () => {
    // US clocks go back on 2026-11-01.
    expect(quote('2026-11-01', '2026-10-31').percent).toBe(50)
    expect(quote('2026-11-02', '2026-10-31').percent).toBe(0)
  })

  it('charges nothing for a date it can’t read, or a price of nothing', () => {
    expect(quote('not-a-date', '2026-11-07').amount).toBe(0)
    expect(quote('2026-11-08', '2026-11-07', 0).amount).toBe(0)
  })
})

describe('todayAtVenue', () => {
  it('reads the day at the course, not where the member is', () => {
    // 06:30 UTC on the 8th is still the evening of the 7th in California.
    const now = new Date('2026-11-08T06:30:00Z')
    expect(todayAtVenue('America/Los_Angeles', now)).toBe('2026-11-07')
    expect(todayAtVenue('America/New_York', now)).toBe('2026-11-08')
  })
})

describe('seatCancellationQuote', () => {
  const course = { cost_per_player: 150, timezone: 'America/Los_Angeles' }
  // Noon in California on the 7th — the day before an 8th round.
  const dayBefore = new Date('2026-11-07T20:00:00Z')
  const seat = {
    cancellation_policy_applies: true,
    status: 'availability_confirmed',
    invite_status: null,
    booking_date: '2026-11-08',
    amount_charged: 150,
  }

  it('quotes a held seat inside the window', () => {
    expect(seatCancellationQuote(seat, course, 'UTC', dayBefore).amount).toBe(75)
  })

  it('prices the seat from what was written onto it', () => {
    expect(seatCancellationQuote({ ...seat, amount_charged: 200 }, course, 'UTC', dayBefore).amount).toBe(100)
    // A row from before amount_charged falls back to the venue's rate.
    expect(seatCancellationQuote({ ...seat, amount_charged: 0 }, course, 'UTC', dayBefore).amount).toBe(75)
  })

  it('is free for a seat booked before the policy existed', () => {
    expect(seatCancellationQuote({ ...seat, cancellation_policy_applies: false }, course, 'UTC', dayBefore).amount).toBe(0)
    expect(seatCancellationQuote({ ...seat, cancellation_policy_applies: undefined }, course, 'UTC', dayBefore).amount).toBe(0)
  })

  it('is free for a request nobody has confirmed, or a seat already let go', () => {
    for (const status of ['awaiting_approval', 'tentative', 'pending', 'cancelled', 'waitlist']) {
      expect(seatCancellationQuote({ ...seat, status }, course, 'UTC', dayBefore).amount).toBe(0)
    }
    for (const status of ['availability_confirmed', 'payment_confirmed', 'confirmed']) {
      expect(seatCancellationQuote({ ...seat, status }, course, 'UTC', dayBefore).amount).toBe(75)
    }
  })

  it('is free for an invitation nobody has answered', () => {
    expect(seatCancellationQuote({ ...seat, invite_status: 'pending' }, course, 'UTC', dayBefore).amount).toBe(0)
    expect(seatCancellationQuote({ ...seat, invite_status: 'accepted' }, course, 'UTC', dayBefore).amount).toBe(75)
  })

  it('says whether the policy covers a seat, so the dialog only states it where it charges', () => {
    expect(seatUnderPolicy(seat)).toBe(true)
    // Covered three days out too, though it costs nothing yet.
    const threeDaysOut = new Date('2026-11-05T20:00:00Z')
    expect(seatCancellationQuote(seat, course, 'UTC', threeDaysOut).amount).toBe(0)
    expect(seatUnderPolicy({ ...seat, cancellation_policy_applies: false })).toBe(false)
    expect(seatUnderPolicy({ ...seat, status: 'awaiting_approval' })).toBe(false)
    expect(seatUnderPolicy({ ...seat, invite_status: 'pending' })).toBe(false)
  })

  it('uses the venue’s day, falling back when the course has no timezone', () => {
    // 06:30 UTC on the 8th: still the 7th at the venue, already the 8th in UTC.
    const lateEvening = new Date('2026-11-08T06:30:00Z')
    expect(seatCancellationQuote(seat, course, 'UTC', lateEvening).percent).toBe(50)
    expect(seatCancellationQuote(seat, { cost_per_player: 150 }, 'UTC', lateEvening).percent).toBe(100)
  })
})

describe('policyLines', () => {
  it('names what each tier comes to for a round at one price', () => {
    expect(policyLines(150)).toEqual([
      'Free to cancel up to 2 days before the round.',
      'Cancelling the day before costs $75 (50%).',
      'Cancelling on the day of the round costs $150.',
    ])
  })

  it('states shares when it isn’t about one round', () => {
    expect(policyLines()).toEqual([
      'Free to cancel up to 2 days before the round.',
      'Cancelling the day before costs 50% of the price.',
      'Cancelling on the day of the round costs the full price.',
    ])
  })
})

describe('card on file', () => {
  it('names a card the way its owner would', () => {
    expect(cardLabel({ brand: 'visa', last4: '4242' })).toBe('Visa •••• 4242')
    expect(cardLabel({ brand: 'link', last4: '0005' })).toBe('Link •••• 0005')
    expect(cardExpiry({ expMonth: 4, expYear: 2029 })).toBe('Expires 04/29')
    expect(cardExpiry({ expMonth: null, expYear: null })).toBe('')
  })

  it('reads a row with no card saved on it as no card', () => {
    expect(cardFromRow(null)).toBeNull()
    expect(cardFromRow({ stripe_payment_method_id: null, card_last4: null })).toBeNull()
    expect(cardFromRow({
      stripe_payment_method_id: 'pm_1', card_brand: 'visa', card_last4: '4242', card_exp_month: 1, card_exp_year: 2030,
    })).toEqual({ brand: 'visa', last4: '4242', expMonth: 1, expYear: 2030 })
  })
})

describe('removing a card', () => {
  it('says why a card holding rounds stays, and what to do instead', () => {
    expect(cardInUseMessage(1)).toBe(
      'This card is holding your spot on an upcoming round. Edit it to use a different card, or remove it once that round has been played.',
    )
    expect(cardInUseMessage(3)).toBe(
      'This card is holding your spot on 3 upcoming rounds. Edit it to use a different card, or remove it once they’ve been played.',
    )
  })
})
