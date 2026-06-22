export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { logger } from '@/lib/logger'
import type { AuthContext } from '@/lib/auth/types'

const VALID_STATUSES = new Set([
  'tentative', 'availability_confirmed', 'payment_confirmed',
  'confirmed', 'pending', 'cancelled', 'waitlist',
])

export const PATCH = withAuth(
  async (req: NextRequest, ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing booking id' }, { status: 400 })

    const body = await req.json() as { status: string }
    if (!body.status || !VALID_STATUSES.has(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    const admin = createAdminClient()

    const { error } = await admin
      .from('bookings')
      .update({ status: body.status })
      .eq('id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    logger.info('Admin updated booking status', {
      action: 'booking.status_updated',
      userId: ctx.userId,
      metadata: { booking_id: id, status: body.status },
    })

    try {
      await admin.from('admin_audit_log').insert({
        admin_id: ctx.userId,
        action: 'booking.status_updated',
        target_type: 'booking',
        target_id: id,
        payload: { status: body.status },
      })
    } catch { /* table may not exist yet */ }

    return NextResponse.json({ ok: true })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
