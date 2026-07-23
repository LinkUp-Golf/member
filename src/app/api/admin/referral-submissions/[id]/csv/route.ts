export const dynamic = 'force-dynamic'

// GET /api/admin/referral-submissions/[id]/csv — download the CSV a partner
// uploaded, verbatim. Served as an attachment so the browser saves it rather
// than rendering it.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { toCsv } from '@/lib/csv'
import type { AuthContext } from '@/lib/auth/types'

export const GET = withAuth(
  async (_req: NextRequest, _ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing submission id' }, { status: 400 })

    const admin = createAdminClient()

    const { data: submission, error } = await admin
      .from('referral_partner_submissions')
      .select('id, csv_content, csv_filename, entries:referral_partner_submission_entries(email, name)')
      .eq('id', id)
      .single()

    if (error || !submission) {
      return NextResponse.json({ error: 'Submission not found' }, { status: 404 })
    }

    // Prefer the original upload. Submissions predating CSV upload have no
    // stored file, so rebuild an equivalent one from their entries rather than
    // failing the download.
    const body = submission.csv_content
      ?? toCsv(
        ['name', 'email'],
        ((submission.entries ?? []) as Array<{ email: string; name: string | null }>)
          .map(e => [e.name, e.email])
      )

    const filename = (submission.csv_filename ?? `referrals-${id}.csv`)
      // Strip anything that could break out of the header value.
      .replace(/["\r\n]/g, '')

    return new NextResponse(body, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
