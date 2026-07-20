import { describe, it, expect, vi, beforeEach } from 'vitest'

// The GHL round-trip for non-members is irrelevant to attribution rules.
vi.mock('@/lib/ghl/client', () => ({
  findOrCreateContactByEmail: vi.fn(async () => 'ghl-contact-1'),
}))

import { linkTargetsToPartner } from '@/lib/referral-links'

const PARTNER = 'partner-a'
const OTHER_PARTNER = 'partner-b'

interface FakeLink {
  id: string
  email: string
  referral_partner_id: string
  member_id?: string | null
}
interface FakeMember { id: string; email: string; ghl_contact_id: string | null }

/**
 * Minimal stand-in for the admin Supabase client covering exactly the calls
 * linkTargetsToPartner makes: `.select().in()` reads against links (by email,
 * then by member_id) and members, then per-target `.insert().select().single()`
 * or `.update().eq()`.
 */
function fakeAdmin({
  links = [],
  members = [],
  paidLinkIds = [],
}: { links?: FakeLink[]; members?: FakeMember[]; paidLinkIds?: string[] }) {
  const inserts: Array<Record<string, unknown>> = []
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = []
  let nextId = 1

  const client = {
    from(table: string) {
      return {
        select: () => ({
          // The real client filters server-side; mirror that here so a lookup
          // by member_id doesn't return links belonging to other people.
          in: async (column: string, values: string[]) => {
            if (table === 'referral_partner_payment_items') {
              return { data: paidLinkIds.filter(id => values.includes(id)).map(link_id => ({ link_id })) }
            }
            if (table !== 'referral_partner_links') return { data: members }
            return {
              data: links.filter(l =>
                column === 'member_id'
                  ? l.member_id != null && values.includes(l.member_id)
                  : values.includes(l.email)
              ),
            }
          },
        }),
        insert: (row: Record<string, unknown>) => {
          // Honour the real table's global UNIQUE(email).
          const clash = links.some(l => l.email === row.email)
          if (clash) {
            return { select: () => ({ single: async () => ({ data: null, error: { code: '23505' } }) }) }
          }
          inserts.push(row)
          const id = `new-link-${nextId++}`
          return { select: () => ({ single: async () => ({ data: { id }, error: null }) }) }
        },
        update: (patch: Record<string, unknown>) => ({
          eq: async (_col: string, id: string) => {
            updates.push({ id, patch })
            return { error: null }
          },
        }),
      }
    },
  }

  return { client, inserts, updates }
}

beforeEach(() => vi.clearAllMocks())

describe('linkTargetsToPartner', () => {
  it('attributes a brand-new contact to the partner', async () => {
    const { client, inserts } = fakeAdmin({})
    const outcomes = await linkTargetsToPartner(client as never, PARTNER, [
      { email: 'new@example.com', name: 'New Person' },
    ])

    expect(outcomes).toEqual([
      { email: 'new@example.com', status: 'linked', linkId: 'new-link-1', memberId: null },
    ])
    expect(inserts[0]).toMatchObject({
      referral_partner_id: PARTNER,
      email: 'new@example.com',
      member_id: null,
    })
  })

  it('links an existing member by email and skips the CRM write', async () => {
    const { client, inserts } = fakeAdmin({
      members: [{ id: 'member-1', email: 'member@example.com', ghl_contact_id: 'existing-ghl' }],
    })
    const outcomes = await linkTargetsToPartner(client as never, PARTNER, [
      { email: 'member@example.com' },
    ])

    expect(outcomes[0]).toMatchObject({ status: 'linked', memberId: 'member-1' })
    expect(inserts[0]).toMatchObject({ member_id: 'member-1', ghl_contact_id: 'existing-ghl' })
  })

  it('reports a contact this partner already referred as "already", not a failure', async () => {
    const { client, inserts } = fakeAdmin({
      links: [{ id: 'link-1', email: 'known@example.com', referral_partner_id: PARTNER }],
    })
    const outcomes = await linkTargetsToPartner(client as never, PARTNER, [
      { email: 'known@example.com' },
    ])

    expect(outcomes).toEqual([{ email: 'known@example.com', status: 'already', linkId: 'link-1' }])
    expect(inserts).toHaveLength(0)
  })

  it('refuses to take a contact from another partner when repoint is off', async () => {
    const { client, inserts, updates } = fakeAdmin({
      links: [{ id: 'link-9', email: 'theirs@example.com', referral_partner_id: OTHER_PARTNER }],
    })
    const outcomes = await linkTargetsToPartner(
      client as never,
      PARTNER,
      [{ email: 'theirs@example.com' }],
      { repoint: false }
    )

    expect(outcomes).toEqual([{
      email: 'theirs@example.com',
      status: 'skipped',
      reason: 'Already attributed to another referral partner',
    }])
    // The other partner's attribution is untouched — this is what stops a
    // submitted list from claiming someone else's referral.
    expect(inserts).toHaveLength(0)
    expect(updates).toHaveLength(0)
  })

  it('moves a contact between partners when repoint is on', async () => {
    const { client, updates } = fakeAdmin({
      links: [{ id: 'link-9', email: 'theirs@example.com', referral_partner_id: OTHER_PARTNER }],
    })
    const outcomes = await linkTargetsToPartner(
      client as never,
      PARTNER,
      [{ email: 'theirs@example.com' }],
      { repoint: true }
    )

    expect(outcomes[0]).toMatchObject({ status: 'linked', linkId: 'link-9' })
    expect(updates[0]).toMatchObject({ id: 'link-9', patch: { referral_partner_id: PARTNER } })
  })

  it('skips malformed addresses without aborting the rest of the batch', async () => {
    const { client } = fakeAdmin({})
    const outcomes = await linkTargetsToPartner(client as never, PARTNER, [
      { email: 'not-an-email' },
      { email: 'good@example.com' },
    ])

    expect(outcomes[0]).toMatchObject({ status: 'skipped', reason: 'Not a valid email address' })
    expect(outcomes[1]).toMatchObject({ status: 'linked' })
  })

  it('normalises case and dedupes within a batch', async () => {
    const { client, inserts } = fakeAdmin({})
    const outcomes = await linkTargetsToPartner(client as never, PARTNER, [
      { email: 'Dup@Example.com', name: 'First Name' },
      { email: 'dup@example.com', name: 'Second Name' },
    ])

    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]?.email).toBe('dup@example.com')
    expect(inserts).toHaveLength(1)
  })

  it('treats a unique-constraint race as an attribution conflict', async () => {
    // The pre-read misses the row, but the insert hits UNIQUE(email).
    const { client } = fakeAdmin({})
    const raced = {
      from: (table: string) => {
        const real = (client as never as { from: (t: string) => Record<string, unknown> }).from(table)
        return {
          ...real,
          insert: () => ({
            select: () => ({ single: async () => ({ data: null, error: { code: '23505' } }) }),
          }),
        }
      },
    }

    // Either constraint (email or member_id) could be the one that fired, so
    // the message stays generic rather than guessing which.
    const outcomes = await linkTargetsToPartner(raced as never, PARTNER, [{ email: 'race@example.com' }])
    expect(outcomes[0]).toMatchObject({ status: 'skipped', reason: 'Already referred' })
  })

  it('returns nothing for an empty batch', async () => {
    const { client } = fakeAdmin({})
    expect(await linkTargetsToPartner(client as never, PARTNER, [])).toEqual([])
  })

  // A member is the same person whichever address they're listed under. Email
  // alone would let someone be referred twice — and paid twice.
  describe('a member can only be referred once', () => {
    it('skips a member already referred by this partner under another address', async () => {
      const { client, inserts } = fakeAdmin({
        links: [{
          id: 'link-1',
          email: 'member@personal.com',
          referral_partner_id: PARTNER,
          member_id: 'member-1',
        }],
        members: [{ id: 'member-1', email: 'member@work.com', ghl_contact_id: 'ghl-1' }],
      })

      // Listed under their work address this time — a different string, same person.
      const outcomes = await linkTargetsToPartner(client as never, PARTNER, [
        { email: 'member@work.com', name: 'Member One' },
      ])

      expect(outcomes).toEqual([
        { email: 'member@work.com', status: 'already', linkId: 'link-1' },
      ])
      expect(inserts).toHaveLength(0)
    })

    it('skips a member already referred by a different partner under another address', async () => {
      const { client, inserts, updates } = fakeAdmin({
        links: [{
          id: 'link-9',
          email: 'member@personal.com',
          referral_partner_id: OTHER_PARTNER,
          member_id: 'member-1',
        }],
        members: [{ id: 'member-1', email: 'member@work.com', ghl_contact_id: 'ghl-1' }],
      })

      const outcomes = await linkTargetsToPartner(
        client as never,
        PARTNER,
        [{ email: 'member@work.com' }],
        { repoint: false }
      )

      expect(outcomes[0]).toMatchObject({
        status: 'skipped',
        reason: 'Already attributed to another referral partner',
      })
      expect(inserts).toHaveLength(0)
      expect(updates).toHaveLength(0)
    })

    it('refuses to move an already-paid link on repoint (would block the new partner payout)', async () => {
    const { client, inserts, updates } = fakeAdmin({
      links: [{
        id: 'link-paid',
        email: 'paid@example.com',
        referral_partner_id: OTHER_PARTNER,
        member_id: 'member-1',
      }],
      members: [{ id: 'member-1', email: 'paid@example.com', ghl_contact_id: 'ghl-1' }],
      paidLinkIds: ['link-paid'], // already has a payment_item under the other partner
    })

    const outcomes = await linkTargetsToPartner(
      client as never,
      PARTNER,
      [{ email: 'paid@example.com' }],
      { repoint: true }
    )

    expect(outcomes[0]).toMatchObject({
      status: 'skipped',
      reason: 'Already paid to another partner — cannot move',
    })
    // Not moved, not duplicated — the paid link stays put.
    expect(updates).toHaveLength(0)
    expect(inserts).toHaveLength(0)
  })

  it('moves the existing link rather than creating a second one when repointing', async () => {
      const { client, inserts, updates } = fakeAdmin({
        links: [{
          id: 'link-9',
          email: 'member@personal.com',
          referral_partner_id: OTHER_PARTNER,
          member_id: 'member-1',
        }],
        members: [{ id: 'member-1', email: 'member@work.com', ghl_contact_id: 'ghl-1' }],
      })

      const outcomes = await linkTargetsToPartner(
        client as never,
        PARTNER,
        [{ email: 'member@work.com' }],
        { repoint: true }
      )

      expect(outcomes[0]).toMatchObject({ status: 'linked', linkId: 'link-9' })
      expect(updates[0]).toMatchObject({ id: 'link-9', patch: { referral_partner_id: PARTNER } })
      // Crucially not a second row for the same person.
      expect(inserts).toHaveLength(0)
    })

    it('still links a member who has never been referred', async () => {
      const { client, inserts } = fakeAdmin({
        members: [{ id: 'member-1', email: 'member@work.com', ghl_contact_id: 'ghl-1' }],
      })
      const outcomes = await linkTargetsToPartner(client as never, PARTNER, [
        { email: 'member@work.com' },
      ])

      expect(outcomes[0]).toMatchObject({ status: 'linked', memberId: 'member-1' })
      expect(inserts).toHaveLength(1)
    })

    it('does not confuse one member with another', async () => {
      const { client, inserts } = fakeAdmin({
        links: [{
          id: 'link-1',
          email: 'one@x.com',
          referral_partner_id: PARTNER,
          member_id: 'member-1',
        }],
        members: [{ id: 'member-2', email: 'two@x.com', ghl_contact_id: null }],
      })

      const outcomes = await linkTargetsToPartner(client as never, PARTNER, [{ email: 'two@x.com' }])
      expect(outcomes[0]).toMatchObject({ status: 'linked', memberId: 'member-2' })
      expect(inserts).toHaveLength(1)
    })

    it('treats a non-member link as email-only, not a member match', async () => {
      // member_id null — nothing to match on beyond the address itself.
      const { client, inserts } = fakeAdmin({
        links: [{
          id: 'link-1',
          email: 'lead@x.com',
          referral_partner_id: PARTNER,
          member_id: null,
        }],
      })

      const outcomes = await linkTargetsToPartner(client as never, PARTNER, [{ email: 'other@x.com' }])
      expect(outcomes[0]).toMatchObject({ status: 'linked' })
      expect(inserts).toHaveLength(1)
    })
  })
})
