import { describe, it, expect } from 'vitest'
import {
  allowsNonMemberGuests,
  isNonMemberSeat,
  maxNonMemberGuests,
  nonMemberGuestLimitMessage,
  parseMaxNonMemberGuests,
  withinNonMemberGuestLimit,
} from '@/lib/bookings/guest-policy'

// Non-member guests are the venue's call, off by default. The booking screen,
// the add-player sheet and both booking routes read this one answer.

describe('allowsNonMemberGuests', () => {
  it('is on only when the venue has switched it on', () => {
    expect(allowsNonMemberGuests({ allow_non_member_guests: true })).toBe(true)
  })

  it('is off when the venue has it off', () => {
    expect(allowsNonMemberGuests({ allow_non_member_guests: false })).toBe(false)
  })

  it('is off when the setting or the venue is missing', () => {
    expect(allowsNonMemberGuests({})).toBe(false)
    expect(allowsNonMemberGuests({ allow_non_member_guests: null })).toBe(false)
    expect(allowsNonMemberGuests(null)).toBe(false)
    expect(allowsNonMemberGuests(undefined)).toBe(false)
  })
})

// As many non-members per booking as the venue takes (one unless an admin
// changes it), counted across the whole booking: the create route counts what
// it's sent, Add player counts what's already seated too.

describe('maxNonMemberGuests', () => {
  it('is one where the venue hasn’t set it', () => {
    expect(maxNonMemberGuests({})).toBe(1)
    expect(maxNonMemberGuests({ max_non_member_guests: null })).toBe(1)
    expect(maxNonMemberGuests(null)).toBe(1)
    expect(maxNonMemberGuests(undefined)).toBe(1)
  })

  it('is the venue’s number', () => {
    expect(maxNonMemberGuests({ max_non_member_guests: 2 })).toBe(2)
    expect(maxNonMemberGuests({ max_non_member_guests: 3 })).toBe(3)
  })

  it('has no ceiling of its own', () => {
    expect(maxNonMemberGuests({ max_non_member_guests: 9 })).toBe(9)
    expect(maxNonMemberGuests({ max_non_member_guests: 25 })).toBe(25)
  })

  it('reads a number that could never be a cap as the default', () => {
    expect(maxNonMemberGuests({ max_non_member_guests: 0 })).toBe(1)
    expect(maxNonMemberGuests({ max_non_member_guests: 1.5 })).toBe(1)
  })
})

describe('parseMaxNonMemberGuests', () => {
  it('takes any whole number from 1 up, as a number or a string', () => {
    expect(parseMaxNonMemberGuests(1)).toBe(1)
    expect(parseMaxNonMemberGuests(12)).toBe(12)
    expect(parseMaxNonMemberGuests('2')).toBe(2)
  })

  it('refuses anything else rather than guessing', () => {
    // The last is past what the integer column can store.
    for (const v of [0, -1, 1.5, '', 'two', null, undefined, true, NaN, 3_000_000_000]) {
      expect(parseMaxNonMemberGuests(v)).toBeNull()
    }
  })
})

describe('withinNonMemberGuestLimit', () => {
  it('lets a booking bring as many as the venue takes', () => {
    expect(withinNonMemberGuestLimit(0, 0, 1)).toBe(true)
    expect(withinNonMemberGuestLimit(0, 1, 1)).toBe(true)
    expect(withinNonMemberGuestLimit(0, 3, 3)).toBe(true)
    expect(withinNonMemberGuestLimit(4, 2, 6)).toBe(true)
    expect(withinNonMemberGuestLimit(1, 1, 2)).toBe(true)
  })

  it('refuses one more, in one request or added later', () => {
    expect(withinNonMemberGuestLimit(0, 2, 1)).toBe(false)
    expect(withinNonMemberGuestLimit(1, 1, 1)).toBe(false)
    expect(withinNonMemberGuestLimit(2, 1, 2)).toBe(false)
  })

  it('still allows adding members once the guests are seated', () => {
    expect(withinNonMemberGuestLimit(1, 0, 1)).toBe(true)
    expect(withinNonMemberGuestLimit(3, 0, 3)).toBe(true)
  })
})

describe('nonMemberGuestLimitMessage', () => {
  it('says the venue’s number', () => {
    expect(nonMemberGuestLimitMessage(1)).toBe(
      'A booking can include one non-member guest. Anyone else you add needs to be a LinkUp member.',
    )
    expect(nonMemberGuestLimitMessage(2)).toBe(
      'A booking can include up to 2 non-member guests. Anyone else you add needs to be a LinkUp member.',
    )
  })
})

describe('isNonMemberSeat', () => {
  const guestAccounts = new Set(['guest-1'])

  it('never counts the booker\'s own row', () => {
    expect(isNonMemberSeat({ guest_name: null, player_member_id: null }, guestAccounts)).toBe(false)
  })

  it('counts a guest seat provisioning has not linked yet', () => {
    expect(isNonMemberSeat({ guest_name: 'Dana Lee', player_member_id: null }, guestAccounts)).toBe(true)
  })

  it('counts a linked seat whose account is a guest\'s', () => {
    expect(isNonMemberSeat({ guest_name: 'Dana Lee', player_member_id: 'guest-1' }, guestAccounts)).toBe(true)
  })

  it('does not count a member invited by name', () => {
    expect(isNonMemberSeat({ guest_name: 'Sam Ortiz', player_member_id: 'member-1' }, guestAccounts)).toBe(false)
  })
})
