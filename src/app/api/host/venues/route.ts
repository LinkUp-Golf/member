export const dynamic = 'force-dynamic'

// GET /api/host/venues — the courses the caller is approved to host events at.
// Empty means "no restriction" (legacy hosts granted before venues existed);
// the event form falls back to all bookable courses in that case.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withHostAuth, type HostAuthContext } from '@/lib/auth/with-host-auth'
import { createAdminClient } from '@/lib/supabase-server'

export const GET = withHostAuth(async (_req: NextRequest, ctx: HostAuthContext) => {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('host_venues')
    .select('course:courses(id, name, city)')
    .eq('host_id', ctx.host.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Flatten the embed, drop any course that's since been removed, and sort by
  // name for a stable dropdown order.
  const venues = (data ?? [])
    .map(r => (Array.isArray(r.course) ? r.course[0] : r.course))
    .filter((c): c is { id: string; name: string; city: string | null } => !!c)
    .sort((a, b) => a.name.localeCompare(b.name))

  return NextResponse.json({ venues })
})
