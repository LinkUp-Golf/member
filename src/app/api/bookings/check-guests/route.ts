export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { findMembersWithPendingPayment } from '@/lib/bookings/pending-payment'
import type { AuthContext } from '@/lib/auth/types'

// GET /api/bookings/check-guests?ids=<uuid>,<uuid>,...
// Given a set of member ids the booker wants to add to a group booking, returns
// the subset that currently has a booking awaiting payment. The Book screen
// calls this the moment a member is selected so it can flag them and disable
// submit early. It returns ids only (no booking detail) so it never leaks
// another member's schedule. POST /api/bookings/create enforces the same rule
// server-side regardless of what this returns.
export const GET = withAuth(
  async (req: NextRequest, _ctx: AuthContext) => {
    const raw = req.nextUrl.searchParams.get('ids') ?? ''
    const ids = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 3) // a group is capped at 4 players -> at most 3 guests

    if (ids.length === 0) {
      return NextResponse.json({ blockedMemberIds: [] })
    }

    const admin = createAdminClient()
    const blocked = await findMembersWithPendingPayment(admin, ids)
    return NextResponse.json({ blockedMemberIds: [...blocked] })
  },
  { skipGHLCheck: true },
)
