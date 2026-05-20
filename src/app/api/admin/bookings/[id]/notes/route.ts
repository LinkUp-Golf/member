import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { logger } from '@/lib/logger'
import type { AuthContext } from '@/lib/auth/types'

export const PATCH = withAuth(
  async (req: NextRequest, ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing booking id' }, { status: 400 })

    const body = await req.json() as { admin_notes: string }
    const notes = typeof body.admin_notes === 'string' ? body.admin_notes.trim() : ''

    const admin = createAdminClient()

    const { error } = await admin
      .from('bookings')
      .update({ admin_notes: notes || null })
      .eq('id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    logger.info('Admin updated booking note', {
      action: 'booking.notes_updated',
      userId: ctx.userId,
      metadata: { booking_id: id },
    })

    try {
      await admin.from('admin_audit_log').insert({
        admin_id: ctx.userId,
        action: 'booking.notes_updated',
        target_type: 'booking',
        target_id: id,
        payload: { admin_notes: notes || null },
      })
    } catch { /* table may not exist yet */ }

    return NextResponse.json({ ok: true })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
