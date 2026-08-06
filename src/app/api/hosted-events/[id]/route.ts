export const dynamic = 'force-dynamic'

// GET /api/hosted-events/[id] — a single hosted event for members: host info,
// pricing, spot availability, and whether the caller is registered.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { enrichHostedEvents } from '@/lib/hosts/events'
import type { AuthContext } from '@/lib/auth/types'
import type { HostedEvent } from '@/types'

export const GET = withAuth(
  async (_req: NextRequest, ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing event id' }, { status: 400 })

    const admin = createAdminClient()

    const { data, error } = await admin
      .from('hosted_events')
      .select('*, course:courses(id, name, city), host:hosts(id, name, member:members!hosts_member_id_fkey(first_name, last_name))')
      .eq('id', id)
      .maybeSingle()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

    const [event] = await enrichHostedEvents(admin, [data as HostedEvent], { memberId: ctx.memberId })
    return NextResponse.json({ event })
  }
)
