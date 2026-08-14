export const dynamic = 'force-dynamic'

// GET /api/admin/hosts/[id]/venues — the host's approved venues.
// PUT /api/admin/hosts/[id]/venues — replace that set.
//
// host_venues used to be write-once: application approval wrote it, course
// approval silently back-granted into it, and nothing could read or change it
// afterwards. Granting a host an extra club, or removing one, meant direct DB
// access. This is the missing admin surface.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { validateUUID } from '@/lib/validation'
import { logger } from '@/lib/logger'
import type { AuthContext } from '@/lib/auth/types'

type RouteCtx = { params: Record<string, string> }

export const GET = withAuth(
  async (_req: NextRequest, _ctx: AuthContext, routeCtx?: RouteCtx) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing host id' }, { status: 400 })

    const admin = createAdminClient()

    const { data: host, error: hostError } = await admin
      .from('hosts')
      .select('id, venues_unrestricted')
      .eq('id', id)
      .maybeSingle()

    if (hostError) return NextResponse.json({ error: hostError.message }, { status: 500 })
    if (!host) return NextResponse.json({ error: 'Host not found' }, { status: 404 })

    const { data, error } = await admin
      .from('host_venues')
      .select('course:courses(id, name, city, approval_status)')
      .eq('host_id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    type VenueRow = { id: string; name: string; city: string | null; approval_status: string }

    const venues = (data ?? [])
      .map(r => (Array.isArray(r.course) ? r.course[0] : r.course) as VenueRow | null)
      .filter((c): c is VenueRow => !!c)
      .sort((a, b) => a.name.localeCompare(b.name))

    return NextResponse.json({ venues, venues_unrestricted: host.venues_unrestricted === true })
  },
  { requireAdmin: true, skipGHLCheck: true }
)

export const PUT = withAuth(
  async (req: NextRequest, ctx: AuthContext, routeCtx?: RouteCtx) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing host id' }, { status: 400 })

    const body = await req.json().catch(() => ({})) as { course_ids?: string[] }
    if (!Array.isArray(body.course_ids)) {
      return NextResponse.json({ error: 'course_ids must be an array' }, { status: 400 })
    }

    const courseIds = Array.from(new Set(body.course_ids))
    if (courseIds.length > 50) {
      return NextResponse.json({ error: 'Too many venues selected' }, { status: 400 })
    }
    if (courseIds.some(cid => !validateUUID(cid, 'Venue').valid)) {
      return NextResponse.json({ error: 'One of the selected venues is invalid' }, { status: 400 })
    }

    const admin = createAdminClient()

    const { data: host, error: hostError } = await admin
      .from('hosts')
      .select('id, venues_unrestricted')
      .eq('id', id)
      .maybeSingle()

    if (hostError) return NextResponse.json({ error: hostError.message }, { status: 500 })
    if (!host) return NextResponse.json({ error: 'Host not found' }, { status: 404 })

    // Pending courses are grantable: that's a club a host proposed which an admin
    // hasn't set up yet, and it is exactly the venue they're being approved for.
    // Same filter as host-application approval — the two must agree.
    let grantable: string[] = []
    if (courseIds.length) {
      const { data: courses, error: coursesError } = await admin
        .from('courses')
        .select('id')
        .in('id', courseIds)
        .eq('active', true)
        .in('approval_status', ['active', 'pending'])

      if (coursesError) return NextResponse.json({ error: coursesError.message }, { status: 500 })

      grantable = (courses ?? []).map(c => c.id)
      const rejected = courseIds.filter(cid => !grantable.includes(cid))
      if (rejected.length) {
        return NextResponse.json(
          { error: 'One or more venues are not available to grant.', rejected },
          { status: 409 }
        )
      }
    }

    // An empty set leaves a scoped host unable to create events, which is a
    // legitimate thing for an admin to want — but it must not be reachable by
    // accident while the host is also unrestricted, because then the venue list
    // means nothing. Refuse the ambiguous combination rather than guessing.
    if (grantable.length === 0 && host.venues_unrestricted !== true) {
      return NextResponse.json(
        { error: 'Grant at least one venue, or mark the host unrestricted first.' },
        { status: 400 }
      )
    }

    const { data: priorVenues } = await admin
      .from('host_venues')
      .select('course_id')
      .eq('host_id', id)
    const before = (priorVenues ?? []).map(v => v.course_id)

    // Replace the set. Deleting only what's no longer granted (rather than all
    // rows) keeps created_at intact for venues that survive the edit.
    const removed = before.filter(cid => !grantable.includes(cid))
    const added = grantable.filter(cid => !before.includes(cid))

    if (removed.length) {
      const { error: delError } = await admin
        .from('host_venues')
        .delete()
        .eq('host_id', id)
        .in('course_id', removed)
      if (delError) return NextResponse.json({ error: delError.message }, { status: 500 })
    }

    if (added.length) {
      const { error: insError } = await admin
        .from('host_venues')
        .insert(added.map(course_id => ({ host_id: id, course_id })))
      if (insError) {
        // Put back what was removed so a partial failure doesn't narrow the host.
        if (removed.length) {
          await admin
            .from('host_venues')
            .insert(removed.map(course_id => ({ host_id: id, course_id })))
        }
        return NextResponse.json({ error: insError.message }, { status: 500 })
      }
    }

    logger.info('Host venues replaced by admin', {
      action: 'admin.host.venues_updated',
      userId: ctx.userId,
      metadata: { host_id: id, added: added.length, removed: removed.length },
    })

    try {
      await admin.from('admin_audit_log').insert({
        admin_id: ctx.userId,
        action: 'hosts.venues.updated',
        target_type: 'host',
        target_id: id,
        payload: { before, after: grantable },
      })
    } catch { /* table may not exist yet */ }

    return NextResponse.json({ ok: true, course_ids: grantable })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
