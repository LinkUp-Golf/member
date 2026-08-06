import { describe, it, expect } from 'vitest'
import {
  loadPartnerConversions,
  statsFromLoaded,
  type PartnerRate,
} from '@/lib/referral-partners'
import { MEMBERSHIP_FEE_USD } from '@/lib/constants'

// Commission on one conversion at 10%.
const FEE_10 = MEMBERSHIP_FEE_USD * 0.1

interface FakeLink {
  id: string
  referral_partner_id: string
  member_id: string | null
  email: string
  converted_at?: string | null
  created_at?: string
}
interface FakeMember {
  id: string
  email: string
  first_name?: string
  last_name?: string
  ghl_tags: string[]
  membership_start_date?: string | null
}

/**
 * Stand-in Supabase client for loadPartnerConversions. Covers its reads (links,
 * members-by-email, members-by-id) and the best-effort snapshot update. The
 * builder is thenable so `await from(...).select().in()` resolves to rows.
 */
function fakeAdmin({
  links = [],
  members = [],
}: { links?: FakeLink[]; members?: FakeMember[] }) {
  const snapshots: Array<{ id: string | null; patch: Record<string, unknown> }> = []

  function from(table: string) {
    const state: {
      table: string
      isUpdate: boolean
      patch: Record<string, unknown> | null
      inCol: string | null
      inVals: string[] | null
      eqId: string | null
    } = { table, isUpdate: false, patch: null, inCol: null, inVals: null, eqId: null }

    const builder: Record<string, unknown> = {
      select: () => builder,
      update: (patch: Record<string, unknown>) => { state.isUpdate = true; state.patch = patch; return builder },
      eq: (col: string, val: string) => { if (col === 'id') state.eqId = val; return builder },
      is: () => builder,
      in: (col: string, vals: string[]) => { state.inCol = col; state.inVals = vals; return builder },
      order: () => builder,
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(result()).then(resolve, reject),
    }

    function result() {
      if (state.isUpdate) {
        snapshots.push({ id: state.eqId, patch: state.patch ?? {} })
        return { data: null, error: null }
      }
      if (state.table === 'referral_partner_links') return { data: links, error: null }
      if (state.table === 'members') {
        const vals = state.inVals ?? []
        const rows = state.inCol === 'id'
          ? members.filter(m => vals.includes(m.id))
          : members.filter(m => vals.includes(m.email))
        return { data: rows, error: null }
      }
      return { data: [], error: null }
    }

    return builder
  }

  return { client: { from }, snapshots }
}

const PARTNER: PartnerRate = { id: 'p1', percentage: 10, ends_at: null }

const link = (over: Partial<FakeLink> & { email: string }): FakeLink => ({
  id: `link-${over.email}`,
  referral_partner_id: 'p1',
  member_id: null,
  converted_at: null,
  created_at: '2026-01-01T00:00:00Z',
  ...over,
})

const member = (over: Partial<FakeMember> & { id: string; email: string }): FakeMember => ({
  ghl_tags: ['avi member'],
  membership_start_date: '2026-03-10',
  ...over,
})

describe('loadPartnerConversions — conversion is membership', () => {
  it('counts a referral whose person is an active member', async () => {
    const { client } = fakeAdmin({
      links: [link({ email: 'jane@x.com' })],
      members: [member({ id: 'm1', email: 'jane@x.com', first_name: 'Jane', last_name: 'Doe' })],
    })

    const { conversions } = await loadPartnerConversions(client as never, [PARTNER])
    const c = conversions.get('p1') ?? []
    expect(c).toHaveLength(1)
    expect(c[0]).toMatchObject({
      email: 'jane@x.com',
      memberId: 'm1',
      name: 'Jane Doe',
      convertedAt: '2026-03-10',
      commission: FEE_10,
      withinRateWindow: true,
    })
  })

  it('does not count a referral whose person never became a member', async () => {
    const { client } = fakeAdmin({
      links: [link({ email: 'lead@x.com' })],
      members: [],
    })
    const { conversions } = await loadPartnerConversions(client as never, [PARTNER])
    expect(conversions.get('p1')).toHaveLength(0)
  })

  it('does not count a member without a membership tag', async () => {
    // A GHL contact that exists but carries no membership tag (a lead, a
    // non-member, or someone whose membership tag was removed).
    for (const tags of [[], ['some-other-tag'], ['nbd client']]) {
      const { client } = fakeAdmin({
        links: [link({ email: 'jane@x.com' })],
        members: [member({ id: 'm1', email: 'jane@x.com', ghl_tags: tags })],
      })
      const { conversions } = await loadPartnerConversions(client as never, [PARTNER])
      expect(conversions.get('p1'), JSON.stringify(tags)).toHaveLength(0)
    }
  })

  it('counts every membership tag variant', async () => {
    for (const tag of ['avi member', 'avi member - active', 'member-active-SD']) {
      const { client } = fakeAdmin({
        links: [link({ email: 'jane@x.com' })],
        members: [member({ id: 'm1', email: 'jane@x.com', ghl_tags: [tag] })],
      })
      const { conversions } = await loadPartnerConversions(client as never, [PARTNER])
      expect(conversions.get('p1'), tag).toHaveLength(1)
    }
  })

  it('dates the conversion to membership_start_date, not the referral date', async () => {
    const { client } = fakeAdmin({
      links: [link({ email: 'jane@x.com', created_at: '2026-05-01T00:00:00Z' })],
      members: [member({ id: 'm1', email: 'jane@x.com', membership_start_date: '2026-03-10' })],
    })
    const { conversions } = await loadPartnerConversions(client as never, [PARTNER])
    expect(conversions.get('p1')?.[0]?.convertedAt).toBe('2026-03-10')
  })

  it('earns no commission when membership started after the rate term', async () => {
    const expiredRate: PartnerRate = { id: 'p1', percentage: 10, ends_at: '2026-02-28' }
    const { client } = fakeAdmin({
      links: [link({ email: 'jane@x.com' })],
      members: [member({ id: 'm1', email: 'jane@x.com', membership_start_date: '2026-03-10' })],
    })
    const { conversions } = await loadPartnerConversions(client as never, [expiredRate])
    expect(conversions.get('p1')?.[0]).toMatchObject({ commission: 0, withinRateWindow: false })
  })

  it('matches by a backfilled member_id even when the link email differs', async () => {
    const { client } = fakeAdmin({
      links: [link({ email: 'old@x.com', member_id: 'm1' })],
      members: [member({ id: 'm1', email: 'new@x.com', first_name: 'Jane', last_name: 'Doe' })],
    })
    const { conversions } = await loadPartnerConversions(client as never, [PARTNER])
    expect(conversions.get('p1')).toHaveLength(1)
  })

  it('snapshots the resolved conversion date onto the link', async () => {
    const { client, snapshots } = fakeAdmin({
      links: [link({ id: 'L1', email: 'jane@x.com', converted_at: null })],
      members: [member({ id: 'm1', email: 'jane@x.com', membership_start_date: '2026-03-10' })],
    })
    await loadPartnerConversions(client as never, [PARTNER])
    await new Promise(r => setTimeout(r, 0)) // let the fire-and-forget snapshot flush
    expect(snapshots).toContainEqual(
      expect.objectContaining({ id: 'L1', patch: expect.objectContaining({ converted_at: '2026-03-10' }) })
    )
  })
})

describe('statsFromLoaded — paying = converted member', () => {
  it('counts commission on referrals who became members only', async () => {
    const { client } = fakeAdmin({
      links: [
        link({ email: 'member@x.com' }),
        link({ email: 'pending@x.com' }),
        link({ email: 'lead@x.com' }),
      ],
      members: [
        member({ id: 'm1', email: 'member@x.com', ghl_tags: ['avi member'] }),
        member({ id: 'm2', email: 'pending@x.com', ghl_tags: [] }),
      ],
    })
    const { links, conversions } = await loadPartnerConversions(client as never, [PARTNER])
    const stats = statsFromLoaded([PARTNER], links, conversions).get('p1')

    expect(stats?.referredCount).toBe(3)   // everyone attributed
    expect(stats?.activeCount).toBe(1)     // only the active member
    expect(stats?.commissionOwed).toBe(FEE_10)
  })
})
