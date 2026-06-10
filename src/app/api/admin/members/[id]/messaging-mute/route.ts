export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import type { AuthContext } from '@/lib/auth/types'

// PATCH /api/admin/members/[id]/messaging-mute
// Body: { muted_until: string | null }
// Sets or clears the messaging mute on a member.
// Pass null to unmute immediately.
export const PATCH = withAuth(
  async (req: NextRequest, ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const memberId = routeCtx?.params?.['id']
    if (!memberId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    if (memberId === ctx.userId) {
      return NextResponse.json({ error: 'You cannot mute yourself.' }, { status: 403 })
    }

    const { muted_until } = await req.json() as { muted_until: string | null }

    // Validate the timestamp when provided
    if (muted_until !== null && muted_until !== undefined) {
      const d = new Date(muted_until)
      if (isNaN(d.getTime())) {
        return NextResponse.json({ error: 'Invalid muted_until timestamp' }, { status: 400 })
      }
    }

    const admin = createAdminClient()

    const { error } = await admin
      .from('members')
      .update({ messaging_muted_until: muted_until ?? null })
      .eq('id', memberId)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    try {
      await admin.from('admin_audit_log').insert({
        admin_id: ctx.userId,
        action: muted_until ? 'members.messaging.mute' : 'members.messaging.unmute',
        target_type: 'member',
        target_id: memberId,
        payload: { muted_until: muted_until ?? null },
      })
    } catch { /* audit log table may not exist */ }

    return NextResponse.json({ ok: true, messaging_muted_until: muted_until ?? null })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
