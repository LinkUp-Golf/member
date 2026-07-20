export const dynamic = 'force-dynamic'

// GET /api/hosted-events — upcoming hosted events any member can browse and
// reserve. Enriched with course, host, spot counts, member price, and whether
// the caller already holds a spot.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { enrichHostedEvents } from '@/lib/hosts/events'
import type { AuthContext } from '@/lib/auth/types'
import type { HostedEvent } from '@/types'

const todayISO = () => new Date().toISOString().slice(0, 10)

export const GET = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  const admin = createAdminClient()

  // ?mine=1 — the caller's own reservations (any event status except draft, so
  // past and cancelled events they hold a spot in still show up). Everything
  // else lists the open, browsable events.
  if (req.nextUrl.searchParams.get('mine') === '1') {
    const { data: regs } = await admin
      .from('hosted_event_registrations')
      .select('hosted_event_id')
      .eq('member_id', ctx.memberId)
      .eq('status', 'reserved')

    const ids = (regs ?? []).map(r => r.hosted_event_id)
    if (ids.length === 0) return NextResponse.json({ events: [] })

    const { data: mineRows, error: mineError } = await admin
      .from('hosted_events')
      .select('*, course:courses(id, name, city), host:hosts(id, name, member:members!hosts_member_id_fkey(first_name, last_name))')
      .in('id', ids)
      .neq('status', 'draft')
      .order('event_date', { ascending: true })

    if (mineError) return NextResponse.json({ error: mineError.message }, { status: 500 })

    const mine = await enrichHostedEvents(admin, (mineRows ?? []) as HostedEvent[], { memberId: ctx.memberId })
    return NextResponse.json({ events: mine })
  }

  const courseId = req.nextUrl.searchParams.get('course_id')
  // Filter to one host's public upcoming events (their member id), for the
  // "events they're hosting" section on a member's profile.
  const hostMemberId = req.nextUrl.searchParams.get('host_member_id')

  let hostId: string | null = null
  if (hostMemberId) {
    const { data: host } = await admin.from('hosts').select('id').eq('member_id', hostMemberId).maybeSingle()
    if (!host) return NextResponse.json({ events: [] })
    hostId = host.id
  }

  let query = admin
    .from('hosted_events')
    .select('*, course:courses(id, name, city), host:hosts(id, name, member:members!hosts_member_id_fkey(first_name, last_name))')
    .eq('status', 'upcoming')
    .gte('event_date', todayISO())
    .order('event_date', { ascending: true })

  if (courseId) query = query.eq('course_id', courseId)
  if (hostId) query = query.eq('host_id', hostId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const events = await enrichHostedEvents(admin, (data ?? []) as HostedEvent[], { memberId: ctx.memberId })
  return NextResponse.json({ events })
})
