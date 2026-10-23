import { createAdminClient } from '@/lib/supabase-server'
import { deleteBooking as deleteGhlAppointment } from '@/lib/ghl/client'
import { logger } from '@/lib/logger'

/**
 * Removes one booking row from LinkUp and its appointment from GHL — the admin's
 * Delete and a member's Cancel are both this.
 *
 * The LinkUp row always goes. It used to wait on GHL and stay put when GHL
 * refused, which left a member looking at a round they had cancelled, with no
 * way to clear it from our side. GHL is now best-effort and second: the row is
 * deleted first, so a failure there touches nothing in GHL, and a failure in GHL
 * is reported back as `ghlDeleted: false` for the caller to say out loud — the
 * appointment is then left for someone to remove in GHL by hand.
 *
 * Callers authorise first; this uses the service role.
 */
export async function deleteBookingEverywhere(booking: {
  id: string
  ghl_booking_id: string | null
}): Promise<{ error: string | null; ghlDeleted: boolean }> {
  const admin = createAdminClient()
  const { error } = await admin.from('bookings').delete().eq('id', booking.id)
  if (error) return { error: error.message, ghlDeleted: false }

  // No appointment to clear counts as cleared.
  if (!booking.ghl_booking_id) return { error: null, ghlDeleted: true }

  const ghlDeleted = await deleteGhlAppointment(booking.ghl_booking_id)
  if (!ghlDeleted) {
    logger.warn('Booking deleted in LinkUp but its GHL appointment could not be removed', {
      action: 'booking.ghl_delete_failed',
      metadata: { booking_id: booking.id, ghl_booking_id: booking.ghl_booking_id },
    })
  }
  return { error: null, ghlDeleted }
}
