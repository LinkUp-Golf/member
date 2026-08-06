export const dynamic = 'force-dynamic'

// GET /api/admin/reports/nonprofits?groupBy=city|community
// Which non-profits members support, ranked within each city or community.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { logger } from '@/lib/logger'
import type { AuthContext } from '@/lib/auth/types'

const GROUP_BY = ['city', 'community'] as const
type GroupBy = (typeof GROUP_BY)[number]

interface Row {
  group_label: string
  nonprofit: string
  member_count: number
}

export const GET = withAuth(
  async (req: NextRequest, _ctx: AuthContext) => {
    const requested = req.nextUrl.searchParams.get('groupBy')
    // Whitelisted rather than passed through: it reaches a SQL function, and
    // an unrecognised value should mean the default view, not an error page.
    const groupBy: GroupBy = GROUP_BY.includes(requested as GroupBy) ? (requested as GroupBy) : 'city'

    // The RPC is SECURITY DEFINER and granted to service_role only — it reads
    // every member's profile regardless of RLS, which is the point of a report
    // and the reason this route is admin-gated.
    const admin = createAdminClient()
    const { data, error } = await admin.rpc('nonprofit_popularity', { p_group_by: groupBy })

    if (error) {
      logger.error('Nonprofit report failed', {
        action: 'admin.report.nonprofits',
        errorMessage: error.message,
      })
      return NextResponse.json({ error: 'Could not build the report.' }, { status: 500 })
    }

    const rows = (data ?? []) as Row[]

    // Grouped here rather than in the UI so the client renders what it's given.
    // The RPC already orders by label then count desc, so pushing in order
    // keeps each group ranked without re-sorting.
    const groups: Array<{ label: string; total: number; entries: Array<{ nonprofit: string; memberCount: number }> }> = []
    const byLabel = new Map<string, (typeof groups)[number]>()

    for (const row of rows) {
      let group = byLabel.get(row.group_label)
      if (!group) {
        group = { label: row.group_label, total: 0, entries: [] }
        byLabel.set(row.group_label, group)
        groups.push(group)
      }
      group.entries.push({ nonprofit: row.nonprofit, memberCount: Number(row.member_count) })
      // Sum of mentions, not distinct members — a member supporting three
      // non-profits counts once against each. Labelled as such in the UI.
      group.total += Number(row.member_count)
    }

    return NextResponse.json({ groupBy, groups })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
