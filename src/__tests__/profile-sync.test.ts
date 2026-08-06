import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GHLContact } from '@/types'
import type { SyncContext } from '@/lib/sync/types'

vi.mock('@/lib/ghl/client', () => ({
  getContactCustomFieldValues: vi.fn(),
}))

import { getContactCustomFieldValues } from '@/lib/ghl/client'
import { syncProfileFromGhl } from '@/lib/sync/profile.sync'

const mockedValues = vi.mocked(getContactCustomFieldValues)

type ProfileRow = {
  business_name: string | null
  role_title: string | null
  linkedin_url: string | null
}

/**
 * Minimal stand-in for the two chains profile.sync uses:
 *   from(t).select(c).eq(k, v).single()
 *   from(t).update(patch).eq(k, v)
 */
function fakeSupabase(profile: ProfileRow) {
  const calls: { updates: Record<string, unknown>[] } = { updates: [] }

  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: profile, error: null }) }),
      }),
      update: (patch: Record<string, unknown>) => {
        calls.updates.push(patch)
        return { eq: async () => ({ error: null }) }
      },
    }),
  }

  return { supabase: client as unknown as SyncContext['supabase'], calls }
}

const CONTACT = { id: 'ghl-1', email: 'a@example.com' } as GHLContact

async function run(profile: ProfileRow) {
  const { supabase, calls } = fakeSupabase(profile)
  await syncProfileFromGhl({
    userId: 'member-1',
    contact: CONTACT,
    ctx: { supabase, requestId: 'test' },
  })
  return calls
}

const blank: ProfileRow = { business_name: null, role_title: null, linkedin_url: null }

beforeEach(() => {
  mockedValues.mockReset()
})

describe('syncProfileFromGhl', () => {
  it('overwrites a stored value that disagrees with GHL', async () => {
    // The point of the change: GHL is the source of truth, so a correction
    // made there has to land even though the column is already populated.
    mockedValues.mockResolvedValue({ 'contact.company_name': 'Ridgeline Capital' })

    const calls = await run({ ...blank, business_name: 'Ridgeline Captial' })

    expect(calls.updates).toHaveLength(1)
    expect(calls.updates[0]).toMatchObject({ business_name: 'Ridgeline Capital' })
  })

  it('still fills a blank column', async () => {
    mockedValues.mockResolvedValue({ 'contact.title': 'Managing Partner' })

    const calls = await run(blank)

    expect(calls.updates[0]).toMatchObject({ role_title: 'Managing Partner' })
  })

  it('leaves a column alone when GHL has no value for it', async () => {
    // getContactCustomFieldValues omits empty fields, so an absent key means
    // "GHL has nothing to say" — not "GHL says blank". Clearing here would wipe
    // a value the member typed in-app.
    mockedValues.mockResolvedValue({ 'contact.company_name': 'Ridgeline Capital' })

    const calls = await run({
      business_name: null,
      role_title: 'Managing Partner',
      linkedin_url: 'https://linkedin.com/in/self-entered',
    })

    expect(calls.updates).toHaveLength(1)
    expect(calls.updates[0]).toMatchObject({ business_name: 'Ridgeline Capital' })
    expect(calls.updates[0]).not.toHaveProperty('role_title')
    expect(calls.updates[0]).not.toHaveProperty('linkedin_url')
  })

  it('writes nothing when GHL already agrees with every column', async () => {
    // Re-syncs run on every login, every webhook and hourly — an unchanged
    // value must not move updated_at or evict the member's cache entry.
    mockedValues.mockResolvedValue({
      'contact.company_name': 'Ridgeline Capital',
      'contact.title': 'Managing Partner',
    })

    const calls = await run({
      business_name: 'Ridgeline Capital',
      role_title: 'Managing Partner',
      linkedin_url: null,
    })

    expect(calls.updates).toHaveLength(0)
  })

  it('writes nothing when GHL returns no custom-field values at all', async () => {
    mockedValues.mockResolvedValue({})

    const calls = await run({ ...blank, business_name: 'Kept As Is' })

    expect(calls.updates).toHaveLength(0)
  })

  it('stamps updated_at alongside the changed columns', async () => {
    mockedValues.mockResolvedValue({ 'contact.linkedin': 'https://linkedin.com/in/ghl' })

    const calls = await run(blank)

    expect(calls.updates[0]).toHaveProperty('updated_at')
    expect(typeof calls.updates[0]!.updated_at).toBe('string')
  })
})
