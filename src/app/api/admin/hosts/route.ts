export const dynamic = 'force-dynamic'

// GET /api/admin/hosts — all hosts with their member, credit balance and event
// counts, for the admin Hosts list.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { summarizeCredits } from '@/lib/credits'
import type { AuthContext } from '@/lib/auth/types'

export const GET = withAuth(
  async (_req: NextRequest, _ctx: AuthContext) => {
    const admin = createAdminClient()

    const { data: hosts, error } = await admin
      .from('hosts')
      // member_id as well as the embed: the credit wallet is keyed on the
      // member, not the host row.
      .select('id, name, status, created_at, member_id, member:members!hosts_member_id_fkey(first_name, last_name, email)')
      .order('created_at', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const hostIds = (hosts ?? []).map(h => h.id)
    const memberIds = [...new Set((hosts ?? []).map(h => h.member_id))]

    // Aggregate ledger + event counts across all hosts in two queries.
    const [{ data: ledger }, { data: events }] = await Promise.all([
      memberIds.length
        ? admin.from('credit_ledger').select('member_id, kind, amount').in('member_id', memberIds)
        : Promise.resolve({ data: [] as { member_id: string; kind: string; amount: number }[] }),
      hostIds.length
        ? admin.from('hosted_events').select('host_id, status').in('host_id', hostIds)
        : Promise.resolve({ data: [] as { host_id: string; status: string }[] }),
    ])

    const ledgerByMember = new Map<string, { kind: string; amount: number }[]>()
    for (const row of (ledger ?? []) as { member_id: string; kind: string; amount: number }[]) {
      const list = ledgerByMember.get(row.member_id) ?? []
      list.push({ kind: row.kind, amount: row.amount })
      ledgerByMember.set(row.member_id, list)
    }
    const eventCount = new Map<string, number>()
    for (const row of (events ?? []) as { host_id: string; status: string }[]) {
      eventCount.set(row.host_id, (eventCount.get(row.host_id) ?? 0) + 1)
    }

    const enriched = (hosts ?? []).map(h => ({
      ...h,
      credits: summarizeCredits(ledgerByMember.get(h.member_id) ?? []),
      event_count: eventCount.get(h.id) ?? 0,
    }))

    return NextResponse.json({ hosts: enriched })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
