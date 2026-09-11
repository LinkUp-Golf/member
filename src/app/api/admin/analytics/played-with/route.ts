export const dynamic = 'force-dynamic'

// ============================================================
// GET /api/admin/analytics/played-with?memberId=<uuid>
// Who this member has shared a round with — bookings at the same
// tee time, plus hosted events they were both on.
//
// All of it, not the report's date window: the question is who
// someone knows, and a 30-day cut of that is nearly always empty.
// See members_played_with (20260911000001) for what counts.
// ============================================================

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { logger } from '@/lib/logger'
import { validateUUID } from '@/lib/validation'
import { titleCaseName } from '@/lib/utils'
import type { AuthContext } from '@/lib/auth/types'

interface PartnerRow {
  member_id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  membership_status: string
  is_admin: boolean
  course_name: string | null
  rounds: number
  upcoming: number
  last_played: string | null
  next_round: string | null
}

export const GET = withAuth(
  async (req: NextRequest, _ctx: AuthContext) => {
    const memberId = req.nextUrl.searchParams.get('memberId') ?? ''
    if (!validateUUID(memberId, 'memberId').valid) {
      return NextResponse.json({ error: 'A valid memberId is required.' }, { status: 400 })
    }

    const admin = createAdminClient()
    const { data, error } = await admin.rpc('members_played_with', { p_member_id: memberId })

    if (error) {
      logger.error('Playing partners lookup failed', {
        action: 'admin.analytics.played_with',
        errorMessage: error.message,
      })
      return NextResponse.json({ error: 'Could not load playing partners.' }, { status: 500 })
    }

    const rows = (data ?? []) as PartnerRow[]

    return NextResponse.json({
      partners: rows.map(row => ({
        memberId: row.member_id,
        // Title-cased for the same reason as the roster: GHL stores names as
        // typed, so half of them arrive lower-case.
        name: titleCaseName(`${row.first_name ?? ''} ${row.last_name ?? ''}`.trim()) || 'Unnamed member',
        email: row.email,
        status: row.membership_status,
        isAdmin: row.is_admin,
        courseName: row.course_name,
        rounds: Number(row.rounds),
        upcoming: Number(row.upcoming),
        lastPlayed: row.last_played,
        nextRound: row.next_round,
      })),
    })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
