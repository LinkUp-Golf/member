export const dynamic = 'force-dynamic'

// GET /api/admin/credit-coupons — every credit code, for reconciliation.
//   ?status=issued|redeemed|void|expired   (default: all)
//   ?member_id=<uuid>
//   ?course_id=<uuid>
//   ?q=<code or partial code>
//   ?sync=1   refresh open codes against GHL before answering
//
// This is the answer to "who paid with credit rather than cash". The admin
// bookings screen reads the same rows straight from Supabase to filter its list;
// this route is for the wider view — codes not tied to a booking, and the totals
// that say how much credit is outstanding versus spent.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { syncCreditCoupons } from '@/lib/credits/coupons'
import { validateUUID } from '@/lib/validation'
import type { AuthContext } from '@/lib/auth/types'
import type { CreditCoupon, CreditCouponStatus } from '@/types'

const STATUSES: CreditCouponStatus[] = ['issued', 'redeemed', 'void', 'expired']

// A page of history, not an export. The date-scoped question is answered by the
// bookings screen; this list is "what's outstanding right now" plus recent
// settlements.
const MAX_ROWS = 200

export const GET = withAuth(
  async (req: NextRequest, _ctx: AuthContext) => {
    const admin = createAdminClient()
    const { searchParams } = req.nextUrl

    if (searchParams.get('sync') === '1') {
      // Best-effort: a GHL outage must not stop an admin seeing the ledger side.
      // Kept small — this is one GHL round-trip per open code and it runs inside
      // a request. The daily cron is what works through a backlog.
      await syncCreditCoupons({ admin, limit: 20 }).catch(() => {})
    }

    let query = admin
      .from('credit_coupons')
      .select('*, course:courses(id, name, payment_url), member:members!credit_coupons_member_id_fkey(first_name, last_name, email)')
      .order('created_at', { ascending: false })
      .limit(MAX_ROWS)

    const status = searchParams.get('status')
    if (status && STATUSES.includes(status as CreditCouponStatus)) {
      query = query.eq('status', status)
    }

    const memberId = searchParams.get('member_id')
    if (memberId && validateUUID(memberId, 'member_id').valid) {
      query = query.eq('member_id', memberId)
    }

    const courseId = searchParams.get('course_id')
    if (courseId && validateUUID(courseId, 'course_id').valid) {
      query = query.eq('course_id', courseId)
    }

    // Codes are what an admin has in hand when a member calls about one, so a
    // partial match on the code is the search that matters. Uppercased because
    // that's how codes are generated and how they're read back.
    const q = searchParams.get('q')?.trim()
    if (q) query = query.ilike('code', `%${q.toUpperCase().replace(/[%_]/g, '')}%`)

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const coupons = (data ?? []) as CreditCoupon[]

    // Outstanding is the number that matters operationally: credit already taken
    // out of wallets that hasn't reached a checkout yet.
    const totals = coupons.reduce(
      (acc, c) => {
        const amount = Number(c.amount)
        acc.count++
        if (c.status === 'issued') { acc.outstanding += amount; acc.outstandingCount++ }
        if (c.status === 'redeemed') { acc.redeemed += amount; acc.redeemedCount++ }
        if (c.status === 'void' || c.status === 'expired') { acc.refunded += amount }
        return acc
      },
      { count: 0, outstanding: 0, outstandingCount: 0, redeemed: 0, redeemedCount: 0, refunded: 0 }
    )

    return NextResponse.json({ coupons, totals })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
