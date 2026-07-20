export const dynamic = 'force-dynamic'

// GET /api/admin/hosts — all hosts with their member, credit balance and event
// counts, for the admin Hosts list.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { summarizeCredits } from '@/lib/hosts/credits'
import type { AuthContext } from '@/lib/auth/types'

export const GET = withAuth(
  async (_req: NextRequest, _ctx: AuthContext) => {
    const admin = createAdminClient()

    const { data: hosts, error } = await admin
      .from('hosts')
      .select('id, name, status, created_at, member:members!hosts_member_id_fkey(first_name, last_name, email)')
      .order('created_at', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const hostIds = (hosts ?? []).map(h => h.id)

    // Aggregate ledger + event counts across all hosts in two queries.
    const [{ data: ledger }, { data: events }] = await Promise.all([
      hostIds.length
        ? admin.from('host_credit_ledger').select('host_id, kind, amount').in('host_id', hostIds)
        : Promise.resolve({ data: [] as { host_id: string; kind: string; amount: number }[] }),
      hostIds.length
        ? admin.from('hosted_events').select('host_id, status').in('host_id', hostIds)
        : Promise.resolve({ data: [] as { host_id: string; status: string }[] }),
    ])

    const ledgerByHost = new Map<string, { kind: string; amount: number }[]>()
    for (const row of (ledger ?? []) as { host_id: string; kind: string; amount: number }[]) {
      const list = ledgerByHost.get(row.host_id) ?? []
      list.push({ kind: row.kind, amount: row.amount })
      ledgerByHost.set(row.host_id, list)
    }
    const eventCount = new Map<string, number>()
    for (const row of (events ?? []) as { host_id: string; status: string }[]) {
      eventCount.set(row.host_id, (eventCount.get(row.host_id) ?? 0) + 1)
    }

    const enriched = (hosts ?? []).map(h => ({
      ...h,
      credits: summarizeCredits(ledgerByHost.get(h.id) ?? []),
      event_count: eventCount.get(h.id) ?? 0,
    }))

    return NextResponse.json({ hosts: enriched })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
