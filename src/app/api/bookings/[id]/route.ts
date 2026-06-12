export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { withAuth } from '@/lib/auth/with-auth'
import { createRouteHandlerClient, createAdminClient } from '@/lib/supabase-server'
import { cancelBooking, updateOpportunityStage } from '@/lib/ghl/client'
import type { AuthContext } from '@/lib/auth/types'

const AVI_PLAY_CANCELLED_STAGE_ID = process.env.GHL_AVI_PLAY_CANCELLED_STAGE_ID ?? ''

export const PATCH = withAuth(async (
  req: NextRequest,
  ctx: AuthContext,
  routeCtx?: { params: Record<string, string> }
) => {
  const supabase = createRouteHandlerClient(cookies())

  const id = routeCtx?.params?.['id']
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const body = await req.json().catch(() => ({})) as { cancellationReason?: string }
  const cancellationReason = body.cancellationReason?.trim() ?? null

  // Fetch booking — allow both the booker and the guest member to act on it
  const { data: booking, error: fetchError } = await supabase
    .from('bookings')
    .select('id, member_id, ghl_booking_id, ghl_opportunity_id, status')
    .eq('id', id)
    .or(`member_id.eq.${ctx.userId},player_member_id.eq.${ctx.userId}`)
    .single()

  if (fetchError || !booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  if (booking.status === 'cancelled') {
    return NextResponse.json({ error: 'Booking is already cancelled' }, { status: 400 })
  }

  // Mark cancelled in Supabase first
  const adminSupabase = createAdminClient()
  const { error: updateError } = await adminSupabase
    .from('bookings')
    .update({ status: 'cancelled', cancellation_reason: cancellationReason })
    .eq('id', id)

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  // Resolve GHL contact ID for the booking owner (best-effort)
  const { data: bookingMember } = await adminSupabase
    .from('members')
    .select('ghl_contact_id')
    .eq('id', booking.member_id)
    .single()

  // Best-effort: mark GHL appointment as cancelled and move opportunity to Cancelled stage
  if (booking.ghl_booking_id) {
    await cancelBooking(booking.ghl_booking_id, bookingMember?.ghl_contact_id ?? undefined).catch(() => {})
  }
  if (booking.ghl_opportunity_id && AVI_PLAY_CANCELLED_STAGE_ID) {
    await updateOpportunityStage(booking.ghl_opportunity_id, AVI_PLAY_CANCELLED_STAGE_ID, 'lost').catch(() => {})
  }

  return NextResponse.json({ success: true })
})
