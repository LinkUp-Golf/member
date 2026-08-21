export const dynamic = 'force-dynamic'

// ============================================================
// GET /api/cron/credit-coupons
// Runs daily (vercel.json). Reconciles open credit codes against GHL: marks the
// used ones spent, and voids ones that never reached GHL at all so their credit
// returns to the wallet.
//
// Nothing else can do either job. GHL doesn't notify us when a coupon is
// redeemed, and the in-app syncs only fire when someone happens to open their
// wallet or the admin list — so without this, a used code would sit looking
// refundable, and credit debited against a coupon that was never created would
// sit debited against nothing.
//
// Codes themselves don't expire (20260822000001), so this no longer sweeps up
// lapsed ones — bar a legacy row still carrying a date.
//
// Idempotent: settle_credit_coupon only acts on a coupon still 'issued', so a
// re-run refunds nothing twice.
//
// Test locally:
//   curl -H "Authorization: Bearer <CRON_SECRET>" \
//     http://localhost:3000/api/cron/credit-coupons
// ============================================================

import { type NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { syncCreditCoupons } from '@/lib/credits/coupons'
import { logger } from '@/lib/logger'

// Each coupon is one GHL round-trip, run sequentially to stay inside the API's
// rate limit — so this is also a bound on how long the run takes. Anything above
// it is picked up tomorrow: the query is expiry-ordered, so the codes closest to
// lapsing are always the ones checked first, and settled rows drop out of the
// 'issued' filter, which makes progress durable across runs.
const MAX_PER_RUN = 100

export async function GET(request: NextRequest) {
  // Fail closed when the secret isn't configured — otherwise the comparison
  // would succeed against the literal string "Bearer undefined".
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { checked, settled } = await syncCreditCoupons({
    admin: createAdminClient(),
    limit: MAX_PER_RUN,
  })

  logger.info('credit-coupons cron ran', {
    action: 'cron.credit_coupons',
    metadata: { checked, settled },
  })

  return NextResponse.json({ ok: true, checked, settled })
}
