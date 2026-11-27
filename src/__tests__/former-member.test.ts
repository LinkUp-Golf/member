import { describe, it, expect } from 'vitest'
import crypto from 'crypto'
import {
  FORMER_MEMBER_STATUS,
  accessUntil,
  becomesFormerMember,
  formerMemberAccessUntil,
  formerMemberShutOut,
  isApiClosedToFormerMember,
  isClosedToFormerMember,
  isFormerMember,
  membershipChanged,
  todayForFormerMembers,
} from '@/lib/auth/former-member'
import { contactIdFromWebhook, verifyContactWebhook } from '@/lib/ghl/contact-webhook'
import type { SupabaseClient } from '@supabase/supabase-js'

describe('becomesFormerMember', () => {
  const wasMember = { membership_start_date: '2026-01-01', membership_status: 'active' }

  it('is a member who lost member-active-SD and holds nothing else', () => {
    expect(becomesFormerMember([], wasMember)).toBe(true)
    expect(becomesFormerMember(['newsletter', 'gender-male'], wasMember)).toBe(true)
  })

  it('is not someone who still holds any access or role tag', () => {
    expect(becomesFormerMember(['member-active-sd'], wasMember)).toBe(false)
    expect(becomesFormerMember(['avi member'], wasMember)).toBe(false)
    expect(becomesFormerMember(['member-guest'], wasMember)).toBe(false)
    expect(becomesFormerMember(['nbd client'], wasMember)).toBe(false)
    expect(becomesFormerMember(['host'], wasMember)).toBe(false)
    expect(becomesFormerMember(['referral-partner'], wasMember)).toBe(false)
  })

  it('is not a contact who was never a member — a prospect stays a guest', () => {
    expect(becomesFormerMember([], { membership_start_date: null, membership_status: 'non_member' })).toBe(false)
    expect(becomesFormerMember([], null)).toBe(false)
  })

  it('stays former once former', () => {
    expect(becomesFormerMember([], { membership_start_date: null, membership_status: FORMER_MEMBER_STATUS })).toBe(true)
  })
})

describe('isFormerMember', () => {
  it('reads the row status, and never an admin', () => {
    expect(isFormerMember({ membership_status: 'cancelled', is_admin: false })).toBe(true)
    expect(isFormerMember({ membership_status: 'cancelled', is_admin: true })).toBe(false)
    expect(isFormerMember({ membership_status: 'active', is_admin: false })).toBe(false)
    expect(isFormerMember({ membership_status: 'non_member', is_admin: false })).toBe(false)
    expect(isFormerMember(null)).toBe(false)
  })
})

describe('membershipChanged', () => {
  it('notices a membership tag removed or added', () => {
    expect(membershipChanged(['member-active-SD'], [])).toBe(true)
    expect(membershipChanged([], ['member-active-SD'])).toBe(true)
  })

  it('ignores changes that do not affect membership', () => {
    expect(membershipChanged(['member-active-SD'], ['MEMBER-ACTIVE-SD', 'newsletter'])).toBe(false)
    expect(membershipChanged([], ['newsletter'])).toBe(false)
  })
})

describe('what a former member with a round ahead can still reach', () => {
  it('closes member chat, Refer a Member, Curated Introductions and booking a round', () => {
    expect(isClosedToFormerMember('/messages', null)).toBe(true)
    expect(isClosedToFormerMember('/messages/abc', null)).toBe(true)
    expect(isClosedToFormerMember('/more/referrals', null)).toBe(true)
    expect(isClosedToFormerMember('/more/match-profile', null)).toBe(true)
    expect(isClosedToFormerMember('/book', null)).toBe(true)
    expect(isClosedToFormerMember('/book', 'book')).toBe(true)
  })

  it('leaves everything else open, including their bookings', () => {
    expect(isClosedToFormerMember('/book', 'my-bookings')).toBe(false)
    expect(isClosedToFormerMember('/book/invitations/x', null)).toBe(false)
    expect(isClosedToFormerMember('/home', null)).toBe(false)
    expect(isClosedToFormerMember('/members', null)).toBe(false)
    expect(isClosedToFormerMember('/more/profile', null)).toBe(false)
    expect(isClosedToFormerMember('/more/payments', null)).toBe(false)
    expect(isClosedToFormerMember('/more/events', null)).toBe(false)
  })

  it('refuses the matching API routes', () => {
    expect(isApiClosedToFormerMember('/api/conversations', 'GET')).toBe(true)
    expect(isApiClosedToFormerMember('/api/conversations/abc/messages', 'POST')).toBe(true)
    expect(isApiClosedToFormerMember('/api/referrals', 'POST')).toBe(true)
    expect(isApiClosedToFormerMember('/api/recommendations', 'GET')).toBe(true)
    expect(isApiClosedToFormerMember('/api/match-survey', 'PUT')).toBe(true)
    expect(isApiClosedToFormerMember('/api/bookings/create', 'POST')).toBe(true)
    expect(isApiClosedToFormerMember('/api/bookings/availability', 'GET')).toBe(true)
    expect(isApiClosedToFormerMember('/api/bookings/abc/players', 'POST')).toBe(true)
    expect(isApiClosedToFormerMember('/api/hosted-events/abc/register', 'POST')).toBe(true)
  })

  it('lets them see and cancel the rounds they have', () => {
    expect(isApiClosedToFormerMember('/api/bookings', 'GET')).toBe(false)
    expect(isApiClosedToFormerMember('/api/bookings/abc', 'DELETE')).toBe(false)
    expect(isApiClosedToFormerMember('/api/bookings/abc/invitation', 'POST')).toBe(false)
    expect(isApiClosedToFormerMember('/api/hosted-events/abc/register', 'DELETE')).toBe(false)
    expect(isApiClosedToFormerMember('/api/members/me', 'GET')).toBe(false)
    expect(isApiClosedToFormerMember('/api/members', 'GET')).toBe(false)
  })
})

describe('accessUntil', () => {
  it('is the last round date from today on', () => {
    expect(accessUntil(['2026-11-30', '2026-12-05', '2026-12-01'], '2026-11-27')).toBe('2026-12-05')
  })

  it('counts a round today — they keep the app through that day', () => {
    expect(accessUntil(['2026-11-27'], '2026-11-27')).toBe('2026-11-27')
  })

  it('is null when every round is past, or there are none', () => {
    expect(accessUntil(['2026-11-26', null, undefined], '2026-11-27')).toBeNull()
    expect(accessUntil([], '2026-11-27')).toBeNull()
  })
})

describe('todayForFormerMembers', () => {
  it('reads the date at the venue (Pacific), not UTC', () => {
    // 06:00 UTC on the 28th is still the 27th in San Diego.
    expect(todayForFormerMembers(new Date('2026-11-28T06:00:00Z'))).toBe('2026-11-27')
  })
})

// A minimal stand-in for the two queries formerMemberAccessUntil makes.
function fakeClient(opts: {
  bookings?: Array<{ booking_date: string }>
  registrations?: Array<{ hosted_event: { event_date: string } | null }>
  error?: string
}): SupabaseClient {
  const result = (data: unknown) => ({ data: opts.error ? null : data, error: opts.error ? { message: opts.error } : null })
  return {
    from(table: string) {
      const data = table === 'bookings' ? (opts.bookings ?? []) : (opts.registrations ?? [])
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'or', 'gte', 'not', 'eq']) chain[m] = () => chain
      chain.then = (resolve: (v: unknown) => unknown) => resolve(result(data))
      return chain
    },
  } as unknown as SupabaseClient
}

describe('formerMemberAccessUntil', () => {
  const now = new Date('2026-11-27T20:00:00Z')

  it('takes the later of a booking and a hosted-round reservation', async () => {
    const client = fakeClient({
      bookings: [{ booking_date: '2026-12-01' }],
      registrations: [{ hosted_event: { event_date: '2026-12-10' } }, { hosted_event: { event_date: '2026-11-01' } }],
    })
    expect(await formerMemberAccessUntil(client, 'm1', now)).toBe('2026-12-10')
  })

  it('is null with nothing ahead', async () => {
    expect(await formerMemberAccessUntil(fakeClient({}), 'm1', now)).toBeNull()
  })

  it('throws on a read error, so the caller chooses how to fail', async () => {
    await expect(formerMemberAccessUntil(fakeClient({ error: 'boom' }), 'm1', now)).rejects.toThrow('boom')
  })
})

describe('formerMemberShutOut', () => {
  const former = { membership_status: 'cancelled', is_admin: false }

  it('shuts out a former member with no round ahead', async () => {
    expect(await formerMemberShutOut(fakeClient({}), 'm1', former)).toBe(true)
  })

  it('lets in a former member with a round ahead', async () => {
    const client = fakeClient({ bookings: [{ booking_date: '2999-01-01' }] })
    expect(await formerMemberShutOut(client, 'm1', former)).toBe(false)
  })

  it('never shuts out someone who is not a former member', async () => {
    expect(await formerMemberShutOut(fakeClient({}), 'm1', { membership_status: 'active' })).toBe(false)
    expect(await formerMemberShutOut(fakeClient({}), 'm1', { ...former, is_admin: true })).toBe(false)
  })

  it('fails open on a read error — withAuth checks again on every call', async () => {
    expect(await formerMemberShutOut(fakeClient({ error: 'boom' }), 'm1', former)).toBe(false)
  })
})

describe('GHL contact webhook', () => {
  const secret = 'shh'

  it('accepts the shared-secret header a GHL workflow can send', () => {
    expect(verifyContactWebhook({ body: '{}', sharedSecretHeader: 'shh', signatureHeader: null, secret })).toBe(true)
    expect(verifyContactWebhook({ body: '{}', sharedSecretHeader: 'nope', signatureHeader: null, secret })).toBe(false)
  })

  it('still accepts a correct HMAC signature, and refuses a wrong one without throwing', () => {
    const body = '{"contactId":"c1"}'
    const sig = crypto.createHmac('sha256', secret).update(body).digest('hex')
    expect(verifyContactWebhook({ body, sharedSecretHeader: null, signatureHeader: sig, secret })).toBe(true)
    expect(verifyContactWebhook({ body, sharedSecretHeader: null, signatureHeader: 'short', secret })).toBe(false)
  })

  it('refuses everything with no secret configured, or no credential sent', () => {
    expect(verifyContactWebhook({ body: '{}', sharedSecretHeader: 'shh', signatureHeader: null, secret: undefined })).toBe(false)
    expect(verifyContactWebhook({ body: '{}', sharedSecretHeader: null, signatureHeader: null, secret })).toBe(false)
  })

  it('finds the contact id under each name GHL uses', () => {
    expect(contactIdFromWebhook({ type: 'contact.tag.removed', contactId: 'c1' })).toBe('c1')
    expect(contactIdFromWebhook({ contact_id: 'c2', tags: 'newsletter' })).toBe('c2')
    expect(contactIdFromWebhook({ type: 'ContactTagUpdate', id: 'c3' })).toBe('c3')
  })

  it('ignores events that are not a contact change, and bodies with no id', () => {
    expect(contactIdFromWebhook({ type: 'OpportunityCreate', id: 'o1' })).toBeNull()
    expect(contactIdFromWebhook({ type: 'contact.updated' })).toBeNull()
    expect(contactIdFromWebhook(null)).toBeNull()
  })
})
