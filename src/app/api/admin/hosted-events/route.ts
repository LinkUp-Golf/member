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

const LIMIT = 300
const isDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v)

export const GET = withAuth(
  async (req: NextRequest, _ctx: AuthContext) => {
    const params = req.nextUrl.searchParams
    const status = params.get('status')
    const hostId = params.get('host_id')
    const courseId = params.get('course_id')
    const from = params.get('from')
    const to = params.get('to')
    const admin = createAdminClient()

    let query = admin
      .from('hosted_events')
      .select(
        '*, course:courses(id, name, city), host:hosts(id, name, status, member:members!hosts_member_id_fkey(first_name, last_name)), proofs:hosted_event_proofs(*)',
        { count: 'exact' }
      )
      // Embeds proofs per row, so this must stay bounded as events accumulate.
      // `count` is exact so the client can tell when it's looking at a truncated
      // list — previously it silently stopped at 300 with no way to know.
      .limit(LIMIT)

    if (status && VALID_STATUSES.has(status)) query = query.eq('status', status)
    if (hostId) query = query.eq('host_id', hostId)
    if (courseId) query = query.eq('course_id', courseId)
    if (isDate(from)) query = query.gte('event_date', from)
    if (isDate(to)) query = query.lte('event_date', to)

    // The credit queue is a work list, so it goes oldest-first: newest-first put
    // the host who had been waiting longest at the bottom of a 300-row list. Every
    // other view is a history, where newest-first is what's wanted.
    const oldestFirst = status === 'pending_credit_approval'
    query = query.order('event_date', { ascending: oldestFirst })

    const { data, error, count } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const events = await enrichHostedEvents(admin, (data ?? []) as HostedEvent[])

    // Counted independently of the filters. It used to be derived from the
    // filtered rows, so it read 0 in every view except the pending one — and
    // nothing consumed it.
    const { count: pendingCount } = await admin
      .from('hosted_events')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending_credit_approval')

    return NextResponse.json({
      events,
      pendingCount: pendingCount ?? 0,
      total: count ?? events.length,
      truncated: (count ?? 0) > events.length,
    })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
