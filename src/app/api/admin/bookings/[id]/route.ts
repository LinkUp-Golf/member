export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { deleteBookingEverywhere } from '@/lib/bookings/delete'
import { logger } from '@/lib/logger'
import type { AuthContext } from '@/lib/auth/types'

// DELETE /api/admin/bookings/[id]
// Permanently removes a booking: the LinkUp row always, its GHL appointment as
// best it can (see deleteBookingEverywhere). `ghlDeleted: false` means the row is
// gone but the appointment is still in GHL.
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

    const { error: deleteError, ghlDeleted } = await deleteBookingEverywhere(booking)
    if (deleteError) return NextResponse.json({ error: deleteError }, { status: 500 })

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
