export const dynamic = 'force-dynamic'

// GET /api/admin/hosts/[id]/events — every round this host has, by venue.
//
// The host detail page could show what a host had earned and which clubs they
// were allowed to list at, but not what they had actually put on. "Which dates
// is this host running at Torrey Pines" meant leaving for the hosted-events
// queue and filtering it, or asking the database.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import type { AuthContext } from '@/lib/auth/types'

export const GET = withAuth(
  async (_req: NextRequest, _ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing host id' }, { status: 400 })

    const admin = createAdminClient()

    const { data, error } = await admin
      .from('hosted_events')
      .select('id, event_date, tee_time, total_spots, member_guest_rate, status, course:courses(id, name, city, approval_status)')
      .eq('host_id', id)
      .order('event_date', { ascending: true })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Grouped by venue here rather than on the page: the grouping is the answer
    // to the question being asked, and doing it once server-side keeps the card
    // to rendering.
    type Row = {
      id: string
      event_date: string
      tee_time: string | null
      total_spots: number
      member_guest_rate: number
      status: string
      course: { id: string; name: string; city: string | null; approval_status: string } | null
    }

    interface VenueEvent {
      id: string
      date: string
      teeTime: string | null
      spots: number
      rate: number
      status: string
    }

    interface VenueGroup {
      courseId: string
      name: string
      city: string | null
      approvalStatus: string
      events: VenueEvent[]
    }

    const byVenue = new Map<string, VenueGroup>()

    for (const raw of (data ?? []) as unknown as Row[]) {
      const course = Array.isArray(raw.course) ? raw.course[0] : raw.course
      // A course row can't actually be missing (the FK is NOT NULL), but a
      // dangling embed would otherwise take the whole card down.
      const key = course?.id ?? 'unknown'
      const group: VenueGroup = byVenue.get(key) ?? {
        courseId: key,
        name: course?.name ?? 'Unknown venue',
        city: course?.city ?? null,
        approvalStatus: course?.approval_status ?? 'unknown',
        events: [],
      }
      group.events.push({
        id: raw.id,
        date: String(raw.event_date).slice(0, 10),
        teeTime: raw.tee_time,
        spots: Number(raw.total_spots),
        rate: Number(raw.member_guest_rate),
        status: raw.status,
      })
      byVenue.set(key, group)
    }

    // Venues with something coming up first — that's what an admin is usually
    // looking for — then the rest by name.
    const today = new Date().toISOString().slice(0, 10)
    const venues = Array.from(byVenue.values()).sort((a, b) => {
      const aNext = a.events.some(e => e.date >= today && e.status === 'upcoming')
      const bNext = b.events.some(e => e.date >= today && e.status === 'upcoming')
      if (aNext !== bNext) return aNext ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    return NextResponse.json({ venues })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
