export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { findPendingPaymentBookings } from '@/lib/bookings/pending-payment'
import type { AuthContext } from '@/lib/auth/types'

// GET /api/bookings/pending-payment
// Returns every one of the member's bookings currently awaiting payment.
// LinkUp enforces a first-in-first-out rule — a member must pay for ALL
// bookings awaiting payment before creating another, at any course — so the
// Book screen uses this to show "payment due" badges/banners ahead of an
// actual booking attempt. POST /api/bookings/create enforces the same rule
// server-side regardless of what this returns.
export const GET = withAuth(
  async (_req: NextRequest, ctx: AuthContext) => {
    const admin = createAdminClient()
    // Only upcoming rounds count as "payment due" — findPendingPaymentBookings
    // scopes to booking_date >= today (a past round has nothing left to pay to
    // confirm), matching the FIFO gate in /api/bookings/create.
    const pendingBookings = await findPendingPaymentBookings(admin, ctx.userId)
    return NextResponse.json({ pendingBookings })
  },
  { skipGHLCheck: true },
)
