import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/ghl/client', () => ({
  getContactByEmail: vi.fn(),
  createContact: vi.fn(),
  addTagToContact: vi.fn(),
}))

vi.mock('@/lib/sync', () => ({
  syncMember: vi.fn(),
}))

import { getContactByEmail, createContact, addTagToContact } from '@/lib/ghl/client'
import { syncMember } from '@/lib/sync'
import { linkGuestToMember, provisionNonMemberGuest } from '@/lib/bookings/non-member-guest'
import { ALL_ACCESS_TAGS, MEMBER_GUEST_TAG } from '@/lib/ghl/tags'

const mockedLookup = vi.mocked(getContactByEmail)
const mockedCreate = vi.mocked(createContact)
const mockedTag = vi.mocked(addTagToContact)
const mockedSync = vi.mocked(syncMember)

const GUEST = { email: 'Ada@example.com', firstName: 'Ada', lastName: 'Byron', mobile: '+15550001' }

/**
 * Stands in for the two things provisioning asks of Supabase:
 *   from('members').select('id').eq('email', …).single()
 *   auth.admin.createUser(…)
 *
 * `memberIds` is consumed one lookup at a time, so a test can say "absent on
 * the first check, present on the retry" — which is the race this guards.
 */
function fakeSupabase({
  memberIds = [null as string | null],
  createUserResult = { data: { user: { id: 'new-user' } }, error: null as { message: string } | null },
} = {}) {
  const calls = { lookups: 0, createUser: 0 }

  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => {
            const id = memberIds[Math.min(calls.lookups, memberIds.length - 1)] ?? null
            calls.lookups++
            return { data: id ? { id } : null, error: id ? null : { message: 'not found' } }
          },
        }),
      }),
    }),
    auth: {
      admin: {
        createUser: async () => {
          calls.createUser++
          return createUserResult
        },
      },
    },
  }

  return { supabase: client as unknown as SupabaseClient, calls }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedLookup.mockResolvedValue(null)
  mockedCreate.mockResolvedValue('contact-new')
  mockedTag.mockResolvedValue(undefined as never)
  mockedSync.mockResolvedValue(undefined as never)
})

describe('provisionNonMemberGuest', () => {
  it('creates the contact and tags it for access', async () => {
    const { supabase } = fakeSupabase()

    const { contactId } = await provisionNonMemberGuest(GUEST, supabase)

    expect(contactId).toBe('contact-new')
    expect(mockedCreate).toHaveBeenCalledOnce()
    // Every access tag, or the app won't recognise them and GHL's membership
    // workflows won't fire — plus member-guest, so GHL can tell someone a
    // member brought along from someone who bought a membership.
    expect(mockedTag).toHaveBeenCalledTimes(ALL_ACCESS_TAGS.length + 1)
    for (const tag of [...ALL_ACCESS_TAGS, MEMBER_GUEST_TAG]) {
      expect(mockedTag).toHaveBeenCalledWith('contact-new', tag)
    }
  })

  it('mirrors the guest tag onto the member row it syncs', async () => {
    // members.ghl_tags is what the app reads; a tag that only exists in GHL
    // until the next full sync is a tag the app can't act on today.
    const { supabase } = fakeSupabase()

    await provisionNonMemberGuest(GUEST, supabase)

    expect(mockedSync).toHaveBeenCalledOnce()
    const [{ contact }] = mockedSync.mock.calls[0] as [{ contact: { tags: string[] } }]
    expect(contact.tags).toContain(MEMBER_GUEST_TAG)
    for (const tag of ALL_ACCESS_TAGS) expect(contact.tags).toContain(tag)
  })

  it('reuses an existing contact rather than creating a second one', async () => {
    // The create route rejects emails that already exist in GHL, but two rows
    // on one booking can name the same guest — the second must not duplicate.
    mockedLookup.mockResolvedValue({ id: 'contact-existing' } as never)
    const { supabase } = fakeSupabase()

    expect((await provisionNonMemberGuest(GUEST, supabase)).contactId).toBe('contact-existing')
    expect(mockedCreate).not.toHaveBeenCalled()
  })

  it('reuses an existing member instead of making another auth user', async () => {
    const { supabase, calls } = fakeSupabase({ memberIds: ['member-existing'] })

    const { memberId } = await provisionNonMemberGuest(GUEST, supabase)

    expect(calls.createUser).toBe(0)
    expect(memberId).toBe('member-existing')
    expect(mockedSync).toHaveBeenCalledOnce()
  })

  it('returns the member it made, so the caller can hand them the round', async () => {
    // Without this the guest is provisioned an account they can sign into and
    // the booking row still names nobody, which is the whole bug: the one
    // person for whom the app is new opens it to no rounds at all.
    const { supabase } = fakeSupabase()

    expect(await provisionNonMemberGuest(GUEST, supabase)).toEqual({
      contactId: 'contact-new',
      memberId: 'new-user',
    })
  })

  it('recovers when a concurrent provision wins the unique email', async () => {
    // members.email is unique. Two seats naming the same new guest race here;
    // the loser must adopt the winner's member, not fail the guest's booking.
    const { supabase, calls } = fakeSupabase({
      memberIds: [null, 'member-raced'],
      createUserResult: { data: { user: null as never }, error: { message: 'duplicate key' } },
    })

    const { contactId } = await provisionNonMemberGuest(GUEST, supabase)

    expect(contactId).toBe('contact-new')
    expect(calls.createUser).toBe(1)
    expect(mockedSync).toHaveBeenCalledOnce()
  })

  it('still returns the contact when the member row cannot be made', async () => {
    // The guest is on the round either way, and the daily GHL sync will pick
    // them up — losing the appointment over this would be the worse outcome.
    const { supabase } = fakeSupabase({
      memberIds: [null, null],
      createUserResult: { data: { user: null as never }, error: { message: 'boom' } },
    })

    await expect(provisionNonMemberGuest(GUEST, supabase)).resolves.toEqual({
      contactId: 'contact-new',
      // Nobody to give the round to. It still happens, and the backfill in
      // 20261002000001 links the row once the sync has caught up.
      memberId: null,
    })
  })

  it('throws when the contact itself cannot be resolved', async () => {
    // Without a contact there is no appointment to make, so the caller has to
    // hear about it and skip the row.
    mockedCreate.mockRejectedValue(new Error('GHL down'))
    const { supabase } = fakeSupabase()

    await expect(provisionNonMemberGuest(GUEST, supabase)).rejects.toThrow('GHL down')
  })
})

/**
 * Records the update the link makes: the columns, the row it names, and the
 * filter that decides which rows it is allowed to touch.
 */
function fakeBookings({ error = null as { message: string } | null } = {}) {
  const update = { payload: null as Record<string, unknown> | null, id: '', nullOnly: false }

  const client = {
    from: (table: string) => {
      if (table !== 'bookings') throw new Error(`unexpected table ${table}`)
      return {
        update: (payload: Record<string, unknown>) => {
          update.payload = payload
          return {
            eq: (_col: string, value: string) => {
              update.id = value
              return {
                is: (col: string, value: null) => {
                  update.nullOnly = col === 'player_member_id' && value === null
                  return Promise.resolve({ error })
                },
              }
            },
          }
        },
      }
    },
  }

  return { admin: client as unknown as SupabaseClient, update }
}

describe('linkGuestToMember', () => {
  const guest = { email: 'ada@example.com', firstName: 'Ada', lastName: 'Byron', mobile: '+15550001' }

  it('puts the member on their own booking row', async () => {
    const { admin, update } = fakeBookings()

    await linkGuestToMember(admin, { bookingId: 'booking-1', guest, memberId: 'member-1' })

    expect(update.id).toBe('booking-1')
    expect(update.payload?.player_member_id).toBe('member-1')
  })

  it('writes the stored player the way an invited member\'s row reads', async () => {
    // A provisioned guest's row should be indistinguishable from a member added
    // by name — the shape 20260708000001 established and its successor looks for.
    const { admin, update } = fakeBookings()

    await linkGuestToMember(admin, { bookingId: 'booking-1', guest, memberId: 'member-1' })

    const players = update.payload?.additional_players as Array<Record<string, unknown>>
    expect(players).toHaveLength(1)
    expect(players[0]).toMatchObject({
      email: 'ada@example.com',
      firstName: 'Ada',
      memberId: 'member-1',
      isNonMember: false,
    })
  })

  it('only ever fills a link that is empty', async () => {
    // Two seats naming the same new guest race through provisioning, and an
    // admin may have linked the row by hand. Last write must not win.
    const { admin, update } = fakeBookings()

    await linkGuestToMember(admin, { bookingId: 'booking-1', guest, memberId: 'member-1' })

    expect(update.nullOnly).toBe(true)
  })

  it('swallows a failure — the seat and the appointment are already made', async () => {
    const { admin } = fakeBookings({ error: { message: 'row locked' } })

    await expect(
      linkGuestToMember(admin, { bookingId: 'booking-1', guest, memberId: 'member-1' }),
    ).resolves.toBeUndefined()
  })
})
