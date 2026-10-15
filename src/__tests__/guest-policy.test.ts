import { describe, it, expect } from 'vitest'
import { allowsNonMemberGuests } from '@/lib/bookings/guest-policy'

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
