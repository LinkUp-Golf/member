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
interface FakeMember { id: string; email: string; first_name?: string; last_name?: string }
interface FakeBooking { member_id: string; status: string; created_at: string }

/**
 * Stand-in Supabase client for loadPartnerConversions. Covers its three reads
 * (links, members, bookings) and the best-effort snapshot update. The builder
 * is thenable so `await from(...).select().in()...` resolves to the right rows;
 * bookings are status-filtered and date-sorted to mirror the real query.
 */
function fakeAdmin({
  links = [],
  members = [],
  bookings = [],
}: { links?: FakeLink[]; members?: FakeMember[]; bookings?: FakeBooking[] }) {
  const snapshots: Array<{ id: string | null; patch: Record<string, unknown> }> = []

  function from(table: string) {
    const state: {
      table: string
      isUpdate: boolean
      patch: Record<string, unknown> | null
      statusFilter: string[] | null
      eqId: string | null
    } = { table, isUpdate: false, patch: null, statusFilter: null, eqId: null }

    const builder: Record<string, unknown> = {
      select: () => builder,
      update: (patch: Record<string, unknown>) => { state.isUpdate = true; state.patch = patch; return builder },
      eq: (col: string, val: string) => { if (col === 'id') state.eqId = val; return builder },
      is: () => builder,
      in: (col: string, vals: string[]) => { if (col === 'status') state.statusFilter = vals; return builder },
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
      if (state.table === 'members') return { data: members, error: null }
      if (state.table === 'bookings') {
        const statusFilter = state.statusFilter
        const rows = statusFilter
          ? bookings.filter(b => statusFilter.includes(b.status))
          : bookings
        // Mirror .order('created_at', { ascending: true }).
        return { data: [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at)), error: null }
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

describe('loadPartnerConversions — conversion is a paid booking', () => {
  it('counts a referral whose member has a payment_confirmed booking', async () => {
    const { client } = fakeAdmin({
      links: [link({ email: 'jane@x.com' })],
      members: [{ id: 'm1', email: 'jane@x.com', first_name: 'Jane', last_name: 'Doe' }],
      bookings: [{ member_id: 'm1', status: 'payment_confirmed', created_at: '2026-03-10T09:00:00Z' }],
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

  it('also counts a finalized (confirmed) booking as paid', async () => {
    const { client } = fakeAdmin({
      links: [link({ email: 'jane@x.com' })],
      members: [{ id: 'm1', email: 'jane@x.com' }],
      bookings: [{ member_id: 'm1', status: 'confirmed', created_at: '2026-03-10T09:00:00Z' }],
    })
    const { conversions } = await loadPartnerConversions(client as never, [PARTNER])
    expect(conversions.get('p1')).toHaveLength(1)
  })

  it('does NOT count a booking that is only availability_confirmed (payment link sent, unpaid)', async () => {
    const { client } = fakeAdmin({
      links: [link({ email: 'jane@x.com' })],
      members: [{ id: 'm1', email: 'jane@x.com' }],
      bookings: [{ member_id: 'm1', status: 'availability_confirmed', created_at: '2026-03-10T09:00:00Z' }],
    })
    const { conversions } = await loadPartnerConversions(client as never, [PARTNER])
    expect(conversions.get('p1')).toHaveLength(0)
  })

  it('does not count a referral whose person never became a member', async () => {
    const { client } = fakeAdmin({
      links: [link({ email: 'lead@x.com' })],
      members: [],
      bookings: [],
    })
    const { conversions } = await loadPartnerConversions(client as never, [PARTNER])
    expect(conversions.get('p1')).toHaveLength(0)
  })

  it('does not count a member who has no paid booking', async () => {
    const { client } = fakeAdmin({
      links: [link({ email: 'jane@x.com' })],
      members: [{ id: 'm1', email: 'jane@x.com' }],
      bookings: [],
    })
    const { conversions } = await loadPartnerConversions(client as never, [PARTNER])
    expect(conversions.get('p1')).toHaveLength(0)
  })

  it('dates the conversion to the earliest paid booking', async () => {
    const { client } = fakeAdmin({
      links: [link({ email: 'jane@x.com' })],
      members: [{ id: 'm1', email: 'jane@x.com' }],
      bookings: [
        { member_id: 'm1', status: 'confirmed', created_at: '2026-05-01T09:00:00Z' },
        { member_id: 'm1', status: 'payment_confirmed', created_at: '2026-03-10T09:00:00Z' },
      ],
    })
    const { conversions } = await loadPartnerConversions(client as never, [PARTNER])
    expect(conversions.get('p1')?.[0]?.convertedAt).toBe('2026-03-10')
  })

  it('earns no commission when the first paid booking is after the rate term', async () => {
    const expiredRate: PartnerRate = { id: 'p1', percentage: 10, ends_at: '2026-02-28' }
    const { client } = fakeAdmin({
      links: [link({ email: 'jane@x.com' })],
      members: [{ id: 'm1', email: 'jane@x.com' }],
      bookings: [{ member_id: 'm1', status: 'payment_confirmed', created_at: '2026-03-10T09:00:00Z' }],
    })
    const { conversions } = await loadPartnerConversions(client as never, [expiredRate])
    expect(conversions.get('p1')?.[0]).toMatchObject({ commission: 0, withinRateWindow: false })
  })

  it('matches by a backfilled member_id even when the link email differs', async () => {
    const { client } = fakeAdmin({
      // Link email is the old address; member_id was backfilled to the real member.
      links: [link({ email: 'old@x.com', member_id: 'm1' })],
      members: [{ id: 'm1', email: 'new@x.com', first_name: 'Jane', last_name: 'Doe' }],
      bookings: [{ member_id: 'm1', status: 'payment_confirmed', created_at: '2026-03-10T09:00:00Z' }],
    })
    const { conversions } = await loadPartnerConversions(client as never, [PARTNER])
    expect(conversions.get('p1')).toHaveLength(1)
  })

  it('snapshots the resolved conversion date onto the link', async () => {
    const { client, snapshots } = fakeAdmin({
      links: [link({ id: 'L1', email: 'jane@x.com', converted_at: null })],
      members: [{ id: 'm1', email: 'jane@x.com' }],
      bookings: [{ member_id: 'm1', status: 'payment_confirmed', created_at: '2026-03-10T09:00:00Z' }],
    })
    await loadPartnerConversions(client as never, [PARTNER])
    // Snapshot is fire-and-forget; let the microtask flush.
    await new Promise(r => setTimeout(r, 0))
    expect(snapshots).toContainEqual(
      expect.objectContaining({ id: 'L1', patch: expect.objectContaining({ converted_at: '2026-03-10' }) })
    )
  })
})

describe('statsFromLoaded — paying = converted', () => {
  it('counts commission on paid referrals only', async () => {
    const { client } = fakeAdmin({
      links: [
        link({ email: 'paid@x.com' }),
        link({ email: 'unpaid@x.com' }),
        link({ email: 'lead@x.com' }),
      ],
      members: [
        { id: 'm1', email: 'paid@x.com' },
        { id: 'm2', email: 'unpaid@x.com' },
      ],
      bookings: [{ member_id: 'm1', status: 'payment_confirmed', created_at: '2026-03-10T09:00:00Z' }],
    })
    const { links, conversions } = await loadPartnerConversions(client as never, [PARTNER])
    const stats = statsFromLoaded([PARTNER], links, conversions).get('p1')

    expect(stats?.referredCount).toBe(3)   // everyone attributed
    expect(stats?.activeCount).toBe(1)     // only the one who paid
    expect(stats?.commissionOwed).toBe(FEE_10)
  })
})
