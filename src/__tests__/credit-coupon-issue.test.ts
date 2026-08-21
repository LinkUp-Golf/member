import { describe, it, expect, vi, beforeEach } from 'vitest'

// A credit code has to pay its round in full — a code worth less than the bill
// is refused at the checkout, which is a worse outcome than not offering one.
// These tests cover the part that can't be checked by reading the sizing rule
// alone: that a balance too small to cover the round is turned away *before*
// anything is debited, and that a client asking for less than the bill can't
// talk the server into issuing a part-paying code anyway.

vi.mock('@/lib/supabase-server', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/ghl/coupons', () => ({
  createGhlCoupon: vi.fn(async () => ({ _id: 'ghl_1' })),
  deleteGhlCoupon: vi.fn(async () => 'deleted'),
  getGhlCoupon: vi.fn(async () => null),
  isDuplicateCouponCodeError: vi.fn(() => false),
}))
vi.mock('@/lib/push', () => ({
  sendPushToMember: vi.fn(async () => {}),
  sendPushToAdmins: vi.fn(async () => {}),
  NotificationTemplates: { creditCouponIssued: () => ({ title: '', body: '' }) },
}))

import { issueCreditCoupon, cancelCreditCoupon, type CouponTarget } from '@/lib/credits/coupons'
import { deleteGhlCoupon, getGhlCoupon } from '@/lib/ghl/coupons'

const MEMBER = '11111111-1111-1111-1111-111111111111'

const bookingTarget: CouponTarget = {
  kind: 'booking',
  bookingId: '44444444-4444-4444-4444-444444444444',
  courseId: '33333333-3333-3333-3333-333333333333',
  price: 160,
}

/**
 * Stands in for the admin Supabase client: a chainable, awaitable builder over
 * a fixed ledger, plus an rpc spy. The spy is the point — a refusal must not
 * reach it, because reaching it is what spends money.
 */
function stubDb(ledger: { amount: number }[]) {
  const rpc = vi.fn(async (fn: string) => {
    if (fn === 'issue_credit_coupon') {
      return {
        data: {
          id: 'coupon-1',
          member_id: MEMBER,
          code: 'LUCAB2CD',
          amount: 160,
          status: 'issued',
          expires_at: null,
          ghl_coupon_id: null,
        },
        error: null,
      }
    }
    return { data: null, error: null }
  })

  const from = vi.fn((table: string) => {
    const result = table === 'credit_ledger' ? { data: ledger } : { data: null }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => result,
      then: (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(ok, err),
    }
    return chain
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { rpc, from } as any
}

beforeEach(() => vi.clearAllMocks())

describe('issueCreditCoupon — a code must cover its round', () => {
  it('refuses a round the balance cannot cover, without debiting anything', async () => {
    const admin = stubDb([{ amount: 55 }])

    const result = await issueCreditCoupon({ admin, memberId: MEMBER, target: bookingTarget })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected a refusal')
    expect(result.status).toBe(409)
    expect(result.shortfall).toBe(105)
    // The member is told the gap, not just that it didn't work.
    expect(result.error).toContain('$105.00')
    // Nothing was spent: no RPC ran at all.
    expect(admin.rpc).not.toHaveBeenCalled()
  })

  it('refuses an empty wallet the same way', async () => {
    const admin = stubDb([])

    const result = await issueCreditCoupon({ admin, memberId: MEMBER, target: bookingTarget })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected a refusal')
    expect(result.status).toBe(409)
    expect(admin.rpc).not.toHaveBeenCalled()
  })

  it('issues for the full bill when the balance covers it', async () => {
    const admin = stubDb([{ amount: 300 }])

    const result = await issueCreditCoupon({ admin, memberId: MEMBER, target: bookingTarget })

    expect(result.ok).toBe(true)
    expect(admin.rpc).toHaveBeenCalledWith(
      'issue_credit_coupon',
      expect.objectContaining({ p_amount: 160, p_member_id: MEMBER }),
    )
  })

  it('ignores a client asking for less than the round costs', async () => {
    // Otherwise a stale or hand-rolled client could mint the part-paying code
    // the whole rule exists to prevent.
    const admin = stubDb([{ amount: 300 }])

    await issueCreditCoupon({ admin, memberId: MEMBER, target: bookingTarget, requested: 20 })

    expect(admin.rpc).toHaveBeenCalledWith(
      'issue_credit_coupon',
      expect.objectContaining({ p_amount: 160 }),
    )
  })

  it('still lets a wallet conversion be any amount up to the balance', async () => {
    // No bill to cover here, so the member names the figure.
    const admin = stubDb([{ amount: 300 }])

    await issueCreditCoupon({
      admin,
      memberId: MEMBER,
      target: { kind: 'general' },
      requested: 20,
    })

    expect(admin.rpc).toHaveBeenCalledWith(
      'issue_credit_coupon',
      expect.objectContaining({ p_amount: 20 }),
    )
  })
})

// Refunding a code turns on what GHL says about it, and each answer means
// something different for the money. The one that used to be wrong: a coupon
// already deleted at GHL was reported to the member as "still valid", and their
// credit stayed debited with no way to get it back.
describe('cancelCreditCoupon — what GHL says decides', () => {
  const COUPON = {
    id: 'coupon-1',
    member_id: MEMBER,
    code: 'LUCAB2CD',
    amount: 160,
    status: 'issued',
    ghl_coupon_id: 'ghl_1',
    expires_at: null,
  }

  /** Chainable stub returning one coupon row, with an rpc spy. */
  function stubCouponDb(row: Record<string, unknown> | null = COUPON) {
    const rpc = vi.fn(async () => ({ data: { ...row, status: 'void' }, error: null }))
    const from = vi.fn((table: string) => {
      const result = table === 'credit_ledger' ? { data: [{ amount: 0 }] } : { data: row }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => result,
        then: (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
          Promise.resolve(result).then(ok, err),
      }
      return chain
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { rpc, from } as any
  }

  it('refunds a code GHL no longer has, instead of calling it still valid', async () => {
    vi.mocked(getGhlCoupon).mockResolvedValueOnce(null)
    const admin = stubCouponDb()

    const result = await cancelCreditCoupon({ admin, couponId: 'coupon-1', memberId: MEMBER, actorId: MEMBER })

    expect(result.ok).toBe(true)
    // Nothing to delete, so no delete was attempted...
    expect(deleteGhlCoupon).not.toHaveBeenCalled()
    // ...and the credit went back.
    expect(admin.rpc).toHaveBeenCalledWith(
      'settle_credit_coupon',
      expect.objectContaining({ p_outcome: 'void', p_coupon_id: 'coupon-1' }),
    )
  })

  it('deletes and refunds a code GHL still has unused', async () => {
    vi.mocked(getGhlCoupon).mockResolvedValueOnce({
      _id: 'ghl_1', code: 'LUCAB2CD', usageCount: 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    vi.mocked(deleteGhlCoupon).mockResolvedValueOnce('deleted')
    const admin = stubCouponDb()

    const result = await cancelCreditCoupon({ admin, couponId: 'coupon-1', memberId: MEMBER, actorId: MEMBER })

    expect(result.ok).toBe(true)
    expect(deleteGhlCoupon).toHaveBeenCalledWith('ghl_1')
    expect(admin.rpc).toHaveBeenCalledWith(
      'settle_credit_coupon',
      expect.objectContaining({ p_outcome: 'void' }),
    )
  })

  it('will not refund a code that has been used — it marks it redeemed', async () => {
    // Refunding here would be giving the round away: the credit already bought
    // something.
    vi.mocked(getGhlCoupon).mockResolvedValueOnce({
      _id: 'ghl_1', code: 'LUCAB2CD', usageCount: 1,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    const admin = stubCouponDb()

    const result = await cancelCreditCoupon({ admin, couponId: 'coupon-1', memberId: MEMBER, actorId: MEMBER })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected a refusal')
    expect(result.status).toBe(409)
    expect(result.error).toMatch(/already been used/i)
    expect(deleteGhlCoupon).not.toHaveBeenCalled()
    expect(admin.rpc).toHaveBeenCalledWith(
      'settle_credit_coupon',
      expect.objectContaining({ p_outcome: 'redeemed' }),
    )
    // Never a void — that would refund spent credit.
    expect(admin.rpc).not.toHaveBeenCalledWith(
      'settle_credit_coupon',
      expect.objectContaining({ p_outcome: 'void' }),
    )
  })

  it('withholds the refund when GHL cannot be reached', async () => {
    // The code may still be live; refunding now would let it be spent twice.
    vi.mocked(getGhlCoupon).mockRejectedValueOnce(new Error('network down'))
    const admin = stubCouponDb()

    const result = await cancelCreditCoupon({ admin, couponId: 'coupon-1', memberId: MEMBER, actorId: MEMBER })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected a refusal')
    expect(result.status).toBe(502)
    expect(result.error).toMatch(/nothing has changed/i)
    expect(admin.rpc).not.toHaveBeenCalled()
  })

  it('withholds the refund when the delete itself fails', async () => {
    vi.mocked(getGhlCoupon).mockResolvedValueOnce({
      _id: 'ghl_1', code: 'LUCAB2CD', usageCount: 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    vi.mocked(deleteGhlCoupon).mockResolvedValueOnce('failed')
    const admin = stubCouponDb()

    const result = await cancelCreditCoupon({ admin, couponId: 'coupon-1', memberId: MEMBER, actorId: MEMBER })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected a refusal')
    expect(result.error).toMatch(/still valid/i)
    expect(admin.rpc).not.toHaveBeenCalled()
  })

  it('refunds when a race deletes it first', async () => {
    vi.mocked(getGhlCoupon).mockResolvedValueOnce({
      _id: 'ghl_1', code: 'LUCAB2CD', usageCount: 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    vi.mocked(deleteGhlCoupon).mockResolvedValueOnce('missing')
    const admin = stubCouponDb()

    const result = await cancelCreditCoupon({ admin, couponId: 'coupon-1', memberId: MEMBER, actorId: MEMBER })

    expect(result.ok).toBe(true)
  })
})
