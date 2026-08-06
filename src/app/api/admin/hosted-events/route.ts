export const dynamic = 'force-dynamic'

// GET /api/admin/hosted-events — all hosted events for admin management, with
// host, course, spot counts and proof images. Optional ?status= filter.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { enrichHostedEvents } from '@/lib/hosts/events'
import type { AuthContext } from '@/lib/auth/types'
import type { HostedEvent } from '@/types'

const VALID_STATUSES = new Set([
  'upcoming', 'completed', 'cancelled',
  'pending_credit_approval', 'credits_awarded',
])

export const GET = withAuth(
  async (req: NextRequest, _ctx: AuthContext) => {
    const status = req.nextUrl.searchParams.get('status')
    const admin = createAdminClient()

    let query = admin
      .from('hosted_events')
      .select('*, course:courses(id, name, city), host:hosts(id, name, member:members!hosts_member_id_fkey(first_name, last_name)), proofs:hosted_event_proofs(*)')
      .order('event_date', { ascending: false })
      // Embeds proofs per row, so this must stay bounded as events accumulate.
      .limit(300)

    if (status && VALID_STATUSES.has(status)) query = query.eq('status', status)

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const events = await enrichHostedEvents(admin, (data ?? []) as HostedEvent[])
    const pendingCount = events.filter(e => e.status === 'pending_credit_approval').length

    return NextResponse.json({ events, pendingCount })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
