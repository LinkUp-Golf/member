export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { deleteBooking } from '@/lib/ghl/client'
import { logger } from '@/lib/logger'
import type { AuthContext } from '@/lib/auth/types'

// DELETE /api/admin/bookings/[id]
// Permanently removes a booking. Deletes the GHL appointment/event first; if that
// fails we abort and leave the Supabase row intact so LinkUp and GHL never drift
// out of sync. Only once GHL is cleared do we delete the Supabase row.
export const DELETE = withAuth(
  async (_req: NextRequest, ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing booking id' }, { status: 400 })

    const admin = createAdminClient()

    const { data: booking, error: fetchError } = await admin
      .from('bookings')
      .select('id, ghl_booking_id')
      .eq('id', id)
      .single()

    if (fetchError || !booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
    }

    let ghlDeleted = true
    if (booking.ghl_booking_id) {
      ghlDeleted = await deleteBooking(booking.ghl_booking_id)
      if (!ghlDeleted) {
        logger.warn('Failed to delete GHL booking; aborting Supabase deletion', {
          action: 'booking.ghl_delete_failed',
          userId: ctx.userId,
          metadata: { booking_id: id, ghl_booking_id: booking.ghl_booking_id },
        })
        return NextResponse.json(
          { error: 'Failed to delete the GHL booking. The booking was not deleted.' },
          { status: 502 }
        )
      }
    }

    const { error: deleteError } = await admin.from('bookings').delete().eq('id', id)
    if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 })

    logger.info('Admin deleted booking', {
      action: 'booking.deleted',
      userId: ctx.userId,
      metadata: { booking_id: id, ghl_booking_id: booking.ghl_booking_id, ghl_deleted: ghlDeleted },
    })

    try {
      await admin.from('admin_audit_log').insert({
        admin_id: ctx.userId,
        action: 'booking.deleted',
        target_type: 'booking',
        target_id: id,
        payload: { ghl_booking_id: booking.ghl_booking_id, ghl_deleted: ghlDeleted },
      })
    } catch { /* table may not exist yet */ }

    return NextResponse.json({ ok: true, ghlDeleted })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
