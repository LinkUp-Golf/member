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
    // Reviewing happens on a partner's own page, so the common case is
    // "this partner's lists". Unfiltered still works for a global count.
    const partnerId = req.nextUrl.searchParams.get('partnerId')
    const admin = createAdminClient()

    let query = admin
      .from('referral_partner_submissions')
      // csv_content excluded — the file is fetched on demand from the /csv
      // download route, not shipped with every row of a list.
      // referral_partners is referenced once from here, so this embed is
      // unambiguous. Its own member_id/created_by columns are not expanded —
      // that nesting WOULD be ambiguous (two FKs to members).
      .select(`
        id, referral_partner_id, status, note, entry_count, imported_count,
        csv_filename, applied_percentage, rejection_reason, reviewed_at,
        created_at, updated_at,
        entries:referral_partner_submission_entries(*),
        partner:referral_partners(id, name, code, percentage, ends_at)
      `)
      .order('created_at', { ascending: false })

    if (status && VALID_STATUSES.has(status)) query = query.eq('status', status)
    if (partnerId) query = query.eq('referral_partner_id', partnerId)

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
