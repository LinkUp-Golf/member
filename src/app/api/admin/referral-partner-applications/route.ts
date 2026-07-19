export const dynamic = 'force-dynamic'

// GET /api/admin/referral-partner-applications — list member applications for
//       the referral-partner role. Optional ?status= filter (default: all).

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import type { AuthContext } from '@/lib/auth/types'

const VALID_STATUSES = new Set(['pending', 'approved', 'rejected'])

export const GET = withAuth(
  async (req: NextRequest, _ctx: AuthContext) => {
    const status = req.nextUrl.searchParams.get('status')
    const admin = createAdminClient()

    let query = admin
      .from('referral_partner_applications')
      // The FK must be named: the table points at members twice (member_id and
      // reviewed_by), so a bare members(...) embed is ambiguous and PostgREST
      // refuses it.
      .select('*, member:members!referral_partner_applications_member_id_fkey(first_name, last_name, email)')
      // Pending first so the review queue is the top of the list, then newest.
      .order('created_at', { ascending: false })

    if (status && VALID_STATUSES.has(status)) query = query.eq('status', status)

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const applications = data ?? []
    const pendingCount = applications.filter(a => a.status === 'pending').length

    return NextResponse.json({ applications, pendingCount })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
