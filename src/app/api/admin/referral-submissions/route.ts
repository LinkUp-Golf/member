export const dynamic = 'force-dynamic'

// GET /api/admin/referral-submissions — referral lists submitted by partners.
// Optional ?status= filter (default: all).

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import type { AuthContext } from '@/lib/auth/types'

const VALID_STATUSES = new Set(['pending', 'imported', 'rejected'])

export const GET = withAuth(
  async (req: NextRequest, _ctx: AuthContext) => {
    const status = req.nextUrl.searchParams.get('status')
    const admin = createAdminClient()

    let query = admin
      .from('referral_partner_submissions')
      // referral_partners is referenced once from here, so this embed is
      // unambiguous. Its own member_id/created_by columns are not expanded —
      // that nesting WOULD be ambiguous (two FKs to members).
      .select('*, entries:referral_partner_submission_entries(*), partner:referral_partners(id, name, code)')
      .order('created_at', { ascending: false })

    if (status && VALID_STATUSES.has(status)) query = query.eq('status', status)

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const submissions = data ?? []
    return NextResponse.json({
      submissions,
      pendingCount: submissions.filter(s => s.status === 'pending').length,
    })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
