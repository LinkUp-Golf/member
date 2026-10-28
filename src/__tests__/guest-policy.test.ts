import { describe, it, expect } from 'vitest'
import {
  allowsNonMemberGuests,
  isNonMemberSeat,
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

// One non-member per booking, counted across the whole booking: the create
// route counts what it's sent, Add player counts what's already seated too.

describe('withinNonMemberGuestLimit', () => {
  it('lets a booking bring one non-member', () => {
    expect(withinNonMemberGuestLimit(0, 0)).toBe(true)
    expect(withinNonMemberGuestLimit(0, 1)).toBe(true)
  })

  it('refuses a second, in one request or added later', () => {
    expect(withinNonMemberGuestLimit(0, 2)).toBe(false)
    expect(withinNonMemberGuestLimit(1, 1)).toBe(false)
  })

  it('still allows adding members once the guest is seated', () => {
    expect(withinNonMemberGuestLimit(1, 0)).toBe(true)
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
