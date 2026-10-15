import { describe, it, expect } from 'vitest'
import {
  canRespondToInvite,
  inviteStatusLabel,
  isInviteResponse,
  isPaidBy,
  paidByLabel,
  whatHappensNext,
} from '@/lib/bookings/invitations'

// An added player is invited, and the booker says who pays for their seat.
// Both booking forms, both booking routes and the invitation screen read these.

describe('isPaidBy', () => {
  it('accepts only the two choices — there is no default', () => {
    expect(isPaidBy('booker')).toBe(true)
    expect(isPaidBy('self')).toBe(true)
    expect(isPaidBy(undefined)).toBe(false)
    expect(isPaidBy('')).toBe(false)
    expect(isPaidBy('club')).toBe(false)
  })
})

describe('isInviteResponse', () => {
  it('accepts accept and decline only', () => {
    expect(isInviteResponse('accept')).toBe(true)
    expect(isInviteResponse('decline')).toBe(true)
    expect(isInviteResponse('maybe')).toBe(false)
  })
})

describe('whatHappensNext', () => {
  it('asks a self-paying player to pay at the pro shop', () => {
    expect(whatHappensNext(false)[1]?.step).toBe('Pay at the pro shop when you arrive')
    expect(whatHappensNext()[1]?.step).toBe('Pay at the pro shop when you arrive')
  })

  it('tells a player the booker is covering to arrive and play', () => {
    expect(whatHappensNext(true)[1]?.step).toBe('Arrive and play')
  })

  it('keeps the first step the same either way', () => {
    expect(whatHappensNext(true)[0]).toEqual(whatHappensNext(false)[0])
  })
})

describe('canRespondToInvite', () => {
  const base = { inviteStatus: 'pending' as const, bookingStatus: 'tentative', bookingDate: '2026-10-20', today: '2026-10-16' }

  it('is open for a pending invitation to an upcoming round', () => {
    expect(canRespondToInvite(base)).toBe(true)
    expect(canRespondToInvite({ ...base, bookingDate: '2026-10-16' })).toBe(true)
  })

  it('is closed once answered', () => {
    expect(canRespondToInvite({ ...base, inviteStatus: 'accepted' })).toBe(false)
    expect(canRespondToInvite({ ...base, inviteStatus: 'declined' })).toBe(false)
  })

  it('is closed for a row nobody was asked about', () => {
    expect(canRespondToInvite({ ...base, inviteStatus: null })).toBe(false)
  })

  it('is closed for a cancelled or past round', () => {
    expect(canRespondToInvite({ ...base, bookingStatus: 'cancelled' })).toBe(false)
    expect(canRespondToInvite({ ...base, bookingDate: '2026-10-15' })).toBe(false)
  })
})

describe('labels', () => {
  it('says who is paying', () => {
    expect(paidByLabel(true, 'Dana Smith')).toBe('Dana Smith is paying for your round')
    expect(paidByLabel(false, 'Dana Smith')).toBe("You'll pay for your own round")
  })

  it('names each answer, and nothing for an unasked row', () => {
    expect(inviteStatusLabel('pending')).toBe('Invite pending')
    expect(inviteStatusLabel('accepted')).toBe('Accepted')
    expect(inviteStatusLabel('declined')).toBe('Declined')
    expect(inviteStatusLabel(null)).toBeNull()
  })
})
