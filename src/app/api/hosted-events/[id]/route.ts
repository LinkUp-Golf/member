export const dynamic = 'force-dynamic'

// GET /api/hosted-events/[id] — a single hosted event for members: host info,
// pricing, spot availability, and whether the caller is registered.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { enrichHostedEvents, isMemberVisible } from '@/lib/hosts/events'
import type { AuthContext } from '@/lib/auth/types'
import type { HostedEvent } from '@/types'

export const GET = withAuth(
  async (_req: NextRequest, ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing event id' }, { status: 400 })

    const admin = createAdminClient()

    const { data, error } = await admin
      .from('hosted_events')
      // payment_url comes along because this is a screen a member pays from:
      // credit issued for the round hands them a code and the checkout to use
      // it at, in the same step.
      .select('*, course:courses(id, name, city, payment_url), host:hosts(id, name, member_id, member:members!hosts_member_id_fkey(first_name, last_name))')
      .eq('id', id)
      .maybeSingle()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

    // An event awaiting approval isn't in browse, but the id would still resolve
    // here — and "invisible to members until approved" has to hold on the direct
    // route too, or the gate is only a listing filter. Its own host and an admin
    // can see it; to everyone else it doesn't exist yet.
    if (!isMemberVisible(data.status)) {
      const host = Array.isArray(data.host) ? data.host[0] : data.host
      const ownHost = host?.member_id === ctx.memberId
      if (!ownHost && !ctx.isAdmin) {
        return NextResponse.json({ error: 'Event not found' }, { status: 404 })
      }
    }

    const [event] = await enrichHostedEvents(admin, [data as HostedEvent], { memberId: ctx.memberId })
    return NextResponse.json({ event })
  }
)
