export const dynamic = 'force-dynamic'

// PATCH /api/admin/hosts/[id] — edit a host: display name, suspend/reactivate,
// and whether their venues are unrestricted.
//
// Until now `hosts` was insert-only. hosts.status carried a CHECK for
// 'suspended', middleware and withHostAuth both refused a suspended host, and
// the admin roster rendered a "Suspended" badge — but nothing in the product
// could ever write that value, so the whole mechanism was unreachable. This is
// the missing write.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { validateString } from '@/lib/validation'
import { logger } from '@/lib/logger'
import type { AuthContext } from '@/lib/auth/types'
import type { HostStatus } from '@/types'

interface PatchBody {
  name?: string
  status?: HostStatus
  venues_unrestricted?: boolean
}

export const PATCH = withAuth(
  async (req: NextRequest, ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing host id' }, { status: 400 })

    const body = await req.json().catch(() => ({})) as PatchBody
    const admin = createAdminClient()

    const { data: host, error: fetchError } = await admin
      .from('hosts')
      .select('id, member_id, name, status, venues_unrestricted')
      .eq('id', id)
      .maybeSingle()

    if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 })
    if (!host) return NextResponse.json({ error: 'Host not found' }, { status: 404 })

    const patch: Record<string, unknown> = {}

    if (typeof body.name === 'string') {
      const nameCheck = validateString(body.name, 'Host name', { min: 2, max: 120 })
      if (!nameCheck.valid) return NextResponse.json({ error: nameCheck.errors[0] }, { status: 400 })
      patch.name = body.name.trim()
    }

    if (body.status !== undefined) {
      if (body.status !== 'active' && body.status !== 'suspended') {
        return NextResponse.json({ error: 'Status must be active or suspended' }, { status: 400 })
      }
      patch.status = body.status
    }

    if (body.venues_unrestricted !== undefined) {
      if (typeof body.venues_unrestricted !== 'boolean') {
        return NextResponse.json({ error: 'venues_unrestricted must be true or false' }, { status: 400 })
      }
      patch.venues_unrestricted = body.venues_unrestricted
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
    }

    patch.updated_at = new Date().toISOString()

    const { data: updated, error } = await admin
      .from('hosts')
      .update(patch)
      .eq('id', id)
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Suspending hides the host's upcoming events from member browse and blocks
    // new reservations — both are joins on hosts.status rather than a write here,
    // so reactivating restores the listings instead of needing them re-created.
    // Existing reservations are deliberately left alone: members already hold
    // those spots, and cancelling them is a separate, explicit decision.

    logger.info('Host updated by admin', {
      action: 'admin.host.updated',
      userId: ctx.userId,
      metadata: { host_id: id, member_id: host.member_id, changed: Object.keys(patch) },
    })

    try {
      await admin.from('admin_audit_log').insert({
        admin_id: ctx.userId,
        action: body.status && body.status !== host.status
          ? `hosts.status.${body.status}`
          : 'hosts.updated',
        target_type: 'host',
        target_id: id,
        payload: {
          before: {
            name: host.name,
            status: host.status,
            venues_unrestricted: host.venues_unrestricted,
          },
          after: patch,
        },
      })
    } catch { /* table may not exist yet */ }

    return NextResponse.json({ ok: true, host: updated })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
