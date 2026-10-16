export const dynamic = 'force-dynamic'

// ============================================================
// GET /api/cron/booking-invite-expiry
// Runs every 15 minutes (vercel.json: "*/15 * * * *"). Expires invitations
// nobody answered in time.
//
// An added player has until INVITE_RESPONSE_CUTOFF_HOURS before the tee time
// (at the venue) to accept or decline — see @/lib/bookings/invitations. Past
// that, an unanswered invitation is marked 'expired' and its row cancelled,
// which frees the seat; its GHL appointment is cancelled with it, and the
// booker is told the spot was released.
//
// The invitation screen already refuses an answer past the cutoff, so a late
// run never lets anyone in late — it only decides when the seat comes back.
// The update is guarded on invite_status = 'pending', so an answer that lands
// mid-run, or an overlapping run, can't be overwritten or expired twice. A
// skipped run self-heals on the next pass.
//
// Test locally:
//   curl -H "Authorization: Bearer <CRON_SECRET>" \
//     http://localhost:3000/api/cron/booking-invite-expiry
// ============================================================

import { type NextRequest, NextResponse } from 'next/server'
import { format } from 'date-fns'
import { createAdminClient } from '@/lib/supabase-server'
import { cancelBooking } from '@/lib/ghl/client'
import { NotificationTemplates } from '@/lib/push'
import { notifyMember } from '@/lib/notify'
import { nameOrEmail } from '@/lib/utils'
import { inviteExpiresAt, inviteHasExpired } from '@/lib/bookings/invitations'
import { AVIARA_TIMEZONE } from '@/lib/constants'
import { logger } from '@/lib/logger'

const dayKey = (d: Date) => d.toISOString().slice(0, 10)
const DAY_MS = 24 * 60 * 60 * 1000

interface PendingRow {
  id: string
  member_id: string
  player_member_id: string | null
  guest_name: string | null
  booking_date: string
  tee_time: string
  ghl_booking_id: string | null
  booker: { ghl_contact_id: string | null } | null
  player: { first_name: string | null; last_name: string | null; email: string | null } | null
  course: { name: string; timezone: string | null } | null
}

export async function GET(request: NextRequest) {
  // Fail closed when the secret isn't configured.
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const admin = createAdminClient()
  const now = new Date()

  // A cutoff five hours before a tee time can only have passed for a round
  // dated up to tomorrow (in any US timezone). Anything earlier than yesterday
  // is a round already played — swept up too, since its seat is moot but its
  // invitation shouldn't sit at 'pending' forever.
  const { data, error } = await admin
    .from('bookings')
    .select(
      'id, member_id, player_member_id, guest_name, booking_date, tee_time, ghl_booking_id, ' +
      'booker:members!bookings_member_id_fkey(ghl_contact_id), ' +
      'player:members!bookings_player_member_id_fkey(first_name, last_name, email), ' +
      'course:courses!bookings_course_id_fkey(name, timezone)',
    )
    .eq('invite_status', 'pending')
    .neq('status', 'cancelled')
    .lte('booking_date', dayKey(new Date(now.getTime() + 2 * DAY_MS)))

  if (error) {
    logger.error('booking-invite-expiry cron failed to fetch', {
      action: 'cron.booking_invite_expiry',
      errorMessage: error.message,
    })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const due = ((data ?? []) as unknown as PendingRow[]).filter(r =>
    inviteHasExpired(
      inviteExpiresAt(r.booking_date, r.tee_time, r.course?.timezone || AVIARA_TIMEZONE),
      now,
    ),
  )

  let expired = 0
  for (const r of due) {
    const { data: updated, error: updateError } = await admin
      .from('bookings')
      .update({
        invite_status: 'expired',
        invite_responded_at: now.toISOString(),
        status: 'cancelled',
        cancellation_reason: 'Invitation expired without an answer',
      })
      .eq('id', r.id)
      .eq('invite_status', 'pending')
      .select('id')
    if (updateError || !updated?.length) continue
    expired++

    if (r.ghl_booking_id) {
      await cancelBooking(r.ghl_booking_id, r.booker?.ghl_contact_id ?? undefined).catch(() => false)
    }

    // Only a round still ahead is worth telling the booker about.
    if (r.booking_date >= dayKey(now)) {
      const playerName =
        nameOrEmail(
          `${r.player?.first_name ?? ''} ${r.player?.last_name ?? ''}`,
          r.player?.email ?? null,
        ) || r.guest_name || 'A player'
      void notifyMember(
        r.member_id,
        NotificationTemplates.bookingInviteExpired(
          playerName,
          r.course?.name ?? 'your round',
          format(new Date(`${r.booking_date}T12:00:00`), 'EEEE, MMMM d'),
        ),
      ).catch(() => {})
    }
  }

  logger.info('booking-invite-expiry cron ran', {
    action: 'cron.booking_invite_expiry',
    metadata: { pending: data?.length ?? 0, expired },
  })

  return NextResponse.json({ expired })
}
