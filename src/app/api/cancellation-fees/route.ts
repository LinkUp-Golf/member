export const dynamic = 'force-dynamic'

// GET /api/cancellation-fees — the member's late-cancellation fees, newest
// first, for /more/payments.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { loadMemberFees } from '@/lib/cancellation/fees'
import type { AuthContext } from '@/lib/auth/types'

export const GET = withAuth(async (_req: NextRequest, ctx: AuthContext) => {
  const fees = await loadMemberFees(createAdminClient(), ctx.memberId)
  return NextResponse.json({ fees })
}, { allowGuests: true })
