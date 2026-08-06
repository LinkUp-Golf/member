import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GHLContact } from '@/types'
import type { SyncContext } from '@/lib/sync/types'

vi.mock('@/lib/ghl/client', () => ({
  getContactCustomFieldValues: vi.fn(),
  getContactCustomFieldValueById: vi.fn(() => ''),
}))

import { getContactCustomFieldValues, getContactCustomFieldValueById } from '@/lib/ghl/client'
import { syncProfileFromGhl } from '@/lib/sync/profile.sync'

const mockedValues = vi.mocked(getContactCustomFieldValues)
const mockedById = vi.mocked(getContactCustomFieldValueById)

type ProfileRow = {
  business_name: string | null
  role_title: string | null
  linkedin_url: string | null
  nonprofits?: string[]
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

const blank: ProfileRow = { business_name: null, role_title: null, linkedin_url: null, nonprofits: [] }

beforeEach(() => {
  mockedValues.mockReset()
  // Default: the contact carries no value under the field id, so the by-key
  // path is what's under test unless a case overrides this.
  mockedById.mockReset()
  mockedById.mockReturnValue('')
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
    // Re-syncs run on every login, every webhook and nightly — an unchanged
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

describe('syncProfileFromGhl — non-profits', () => {
  it('splits the per-line GHL value into entries', async () => {
    mockedValues.mockResolvedValue({ 'contact.nonprofits': 'Boys & Girls Club\nHabitat for Humanity' })

    const calls = await run(blank)

    expect(calls.updates[0]).toMatchObject({
      nonprofits: ['Boys & Girls Club', 'Habitat for Humanity'],
    })
  })

  it('trims, drops blank lines and dedupes case-insensitively', async () => {
    mockedValues.mockResolvedValue({
      'contact.nonprofits': '  Red Cross  \n\n\nred cross\nHabitat for Humanity\n',
    })

    const calls = await run(blank)

    // First spelling wins, so the member's own capitalisation survives.
    expect(calls.updates[0]).toMatchObject({ nonprofits: ['Red Cross', 'Habitat for Humanity'] })
  })

  it('keeps the first three when GHL carries more', async () => {
    // A GHL contact with four is a value we don't control. Truncate rather
    // than abandon the sync — the other columns still need to land.
    mockedValues.mockResolvedValue({
      'contact.nonprofits': 'One\nTwo\nThree\nFour',
      'contact.title': 'Managing Partner',
    })

    const calls = await run(blank)

    expect(calls.updates[0]).toMatchObject({
      nonprofits: ['One', 'Two', 'Three'],
      role_title: 'Managing Partner',
    })
  })

  it('falls back to the field id when the object key was renamed in GHL', async () => {
    mockedValues.mockResolvedValue({})
    mockedById.mockReturnValue('Surfrider Foundation')

    const calls = await run(blank)

    expect(calls.updates[0]).toMatchObject({ nonprofits: ['Surfrider Foundation'] })
  })

  it('does not clear a member-entered list when GHL has no value', async () => {
    // Same ambiguity as the string columns: an absent key means "GHL has
    // nothing to say", not "GHL says empty". This field is editable in-app, so
    // clearing it here would delete the member's own entry.
    mockedValues.mockResolvedValue({ 'contact.title': 'Managing Partner' })

    const calls = await run({ ...blank, nonprofits: ['Red Cross'] })

    expect(calls.updates).toHaveLength(1)
    expect(calls.updates[0]).not.toHaveProperty('nonprofits')
  })

  it('writes nothing when GHL already agrees, order included', async () => {
    mockedValues.mockResolvedValue({ 'contact.nonprofits': 'Red Cross\nHabitat for Humanity' })

    const calls = await run({ ...blank, nonprofits: ['Red Cross', 'Habitat for Humanity'] })

    expect(calls.updates).toHaveLength(0)
  })

  it('rewrites when only the order changed', async () => {
    // Order is what the member sees on their profile, so it's part of the value.
    mockedValues.mockResolvedValue({ 'contact.nonprofits': 'Habitat for Humanity\nRed Cross' })

    const calls = await run({ ...blank, nonprofits: ['Red Cross', 'Habitat for Humanity'] })

    expect(calls.updates[0]).toMatchObject({
      nonprofits: ['Habitat for Humanity', 'Red Cross'],
    })
  })
})
