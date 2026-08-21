export const dynamic = 'force-dynamic'

// GET /api/host/venues — the courses the caller is approved to host events at,
// plus whether they are scoped at all.
//
// `unrestricted` comes from hosts.venues_unrestricted and is what the event form
// keys its fallback off. It used to infer that from the venue list being empty,
// which meant a host whose venues failed to load, or whose grant produced
// nothing, was silently offered every bookable course.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withHostAuth, type HostAuthContext } from '@/lib/auth/with-host-auth'
import { createAdminClient } from '@/lib/supabase-server'

export const GET = withHostAuth(async (_req: NextRequest, ctx: HostAuthContext) => {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('host_venues')
    .select('course:courses(id, name, city, state, address, logo_url, map_link, booking_url, cost_per_player, description, approval_status, active)')
    .eq('host_id', ctx.host.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Flatten the embed, drop any course that's since been removed or deactivated,
  // and sort by name for a stable dropdown order. `approval_status` travels with
  // the venue so the form can distinguish a club that's live from one the host
  // proposed and an admin hasn't set up yet — both are legitimately selectable,
  // but they aren't the same thing.
  // Enough for the event form to show what the venue actually is — a host
  // picking between clubs shouldn't have to leave the form to remember which
  // one is which.
  type VenueRow = {
    id: string
    name: string
    city: string | null
    state: string | null
    address: string | null
    logo_url: string | null
    map_link: string | null
    booking_url: string | null
    cost_per_player: number | null
    description: string | null
    approval_status: string
    active: boolean
  }

  const venues = (data ?? [])
    .map(r => (Array.isArray(r.course) ? r.course[0] : r.course) as VenueRow | null)
    .filter((c): c is VenueRow => !!c && c.active)
    .map(({ active: _active, ...venue }) => venue)
    .sort((a, b) => a.name.localeCompare(b.name))

  return NextResponse.json({ venues, unrestricted: ctx.host.venues_unrestricted === true })
})
