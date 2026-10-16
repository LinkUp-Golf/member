import { describe, it, expect } from 'vitest'
import {
  canRespondToInvite,
  INVITE_RESPONSE_CUTOFF_HOURS,
  inviteExpiresAt,
  inviteHasExpired,
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

describe('inviteExpiresAt', () => {
  it('is five hours before the tee time, at the venue', () => {
    // 1:30 PM Pacific daylight time is 20:30 UTC; five hours earlier is 15:30.
    expect(inviteExpiresAt('2026-10-20', '13:30:00', 'America/Los_Angeles')?.toISOString())
      .toBe('2026-10-20T15:30:00.000Z')
    expect(INVITE_RESPONSE_CUTOFF_HOURS).toBe(5)
  })

  it('reaches into the day before for an early tee time', () => {
    // 7:00 AM Pacific is 14:00 UTC; five hours earlier is 09:00 UTC, 2 AM local.
    expect(inviteExpiresAt('2026-10-20', '07:00', 'America/Los_Angeles')?.toISOString())
      .toBe('2026-10-20T09:00:00.000Z')
    // 3:00 AM local, five hours earlier, is the previous evening there.
    expect(inviteExpiresAt('2026-10-20', '03:00:00', 'America/Los_Angeles')?.toISOString())
      .toBe('2026-10-20T05:00:00.000Z')
  })

  it('is null when the date cannot be read', () => {
    expect(inviteExpiresAt('not-a-date', '13:30:00', 'America/Los_Angeles')).toBeNull()
  })
})

describe('canRespondToInvite', () => {
  const expiresAt = new Date('2026-10-20T15:30:00Z')
  const before = new Date('2026-10-20T15:29:00Z')
  const base = { inviteStatus: 'pending' as const, bookingStatus: 'tentative', expiresAt, now: before }

  it('is open for a pending invitation before its cutoff', () => {
    expect(canRespondToInvite(base)).toBe(true)
  })

  it('closes at the cutoff', () => {
    expect(canRespondToInvite({ ...base, now: expiresAt })).toBe(false)
    expect(canRespondToInvite({ ...base, now: new Date('2026-10-20T18:00:00Z') })).toBe(false)
    expect(inviteHasExpired(expiresAt, before)).toBe(false)
    expect(inviteHasExpired(expiresAt, expiresAt)).toBe(true)
  })

  it('treats an unreadable deadline as passed', () => {
    expect(canRespondToInvite({ ...base, expiresAt: null })).toBe(false)
  })

  it('is closed once answered or expired', () => {
    expect(canRespondToInvite({ ...base, inviteStatus: 'accepted' })).toBe(false)
    expect(canRespondToInvite({ ...base, inviteStatus: 'declined' })).toBe(false)
    expect(canRespondToInvite({ ...base, inviteStatus: 'expired' })).toBe(false)
  })

  it('is closed for a row nobody was asked about, or a cancelled round', () => {
    expect(canRespondToInvite({ ...base, inviteStatus: null })).toBe(false)
    expect(canRespondToInvite({ ...base, bookingStatus: 'cancelled' })).toBe(false)
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
    expect(inviteStatusLabel('expired')).toBe('Expired')
    expect(inviteStatusLabel(null)).toBeNull()
  })
})
