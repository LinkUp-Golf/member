export const dynamic = 'force-dynamic'

// ============================================================
// POST /api/webhooks/ghl/bookings
//
// Receives GHL workflow HTTP actions that signal booking status
// changes. Updates all Supabase booking rows in the group.
//
// AUTH
//   Header: x-linkup-secret: <GHL_BOOKING_WEBHOOK_SECRET>
//   Set this as a custom header in every GHL workflow HTTP action.
//
// SUPPORTED EVENTS
//   event: "availability_confirmed"  — opportunity moved to Availability Confirmed stage
//   event: "payment_confirmed"       — opportunity moved to Payment Confirmed stage
//   event: "cancelled"               — opportunity cancelled OR appointment deleted
//
// REQUIRED PAYLOAD (JSON body)
//   {
//     "event": "availability_confirmed" | "payment_confirmed" | "cancelled",
//     "ghlBookingId": "{{appointment.id}}"
//   }
//
// GHL WORKFLOW SETUP (hand this to the workflow developer)
// ─────────────────────────────────────────────────────────
//   1. Trigger: "Opportunity Stage Changed" (or "Appointment Cancelled")
//   2. Action: HTTP Request
//        Method : POST
//        URL    : https://app.linkup.golf/api/webhooks/ghl/bookings
//        Headers: Content-Type: application/json
//                 x-linkup-secret: <GHL_BOOKING_WEBHOOK_SECRET value from .env>
//        Body   : {
//                   "event": "availability_confirmed",   ← hardcode per workflow
//                   "ghlBookingId": "{{appointment.id}}"
//                 }
//   3. Create one workflow per event type, each hardcoding its own "event" value.
//      The merge field {{appointment.id}} resolves to the GHL calendar event ID.
//
// NOTE: ghlBookingId is the GHL calendar appointment/event ID (not opportunity ID).
//       It is available as {{appointment.id}} in GHL workflow merge fields.
// ============================================================

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { cancelBooking } from '@/lib/ghl/client'
import { logger } from '@/lib/logger'

type BookingEvent = 'availability_confirmed' | 'payment_confirmed' | 'cancelled'

const VALID_EVENTS = new Set<BookingEvent>([
  'availability_confirmed',
  'payment_confirmed',
  'cancelled',
])

export async function POST(request: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────
  const secret = request.headers.get('x-linkup-secret')
  if (!secret || secret !== (process.env.GHL_BOOKING_WEBHOOK_SECRET ?? '')) {
    logger.warn('GHL booking webhook: invalid secret')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Parse ──────────────────────────────────────────────────
  let body: { event?: string; ghlBookingId?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { event, ghlBookingId } = body

  if (!event || !ghlBookingId) {
    return NextResponse.json({ error: 'event and ghlBookingId are required' }, { status: 400 })
  }

  if (!VALID_EVENTS.has(event as BookingEvent)) {
    return NextResponse.json({ error: `Unknown event: ${event}` }, { status: 400 })
  }

  logger.info('GHL booking webhook received', {
    action: 'ghl_booking_webhook',
    metadata: { event, ghlBookingId },
  })

  const supabase = createAdminClient()

  // ── Find primary booking by GHL appointment ID ─────────────
  const { data: primary, error: findError } = await supabase
    .from('bookings')
    .select('id, ghl_booking_id, status')
    .eq('ghl_booking_id', ghlBookingId)
    .maybeSingle()

  if (findError) {
    logger.error('GHL booking webhook: DB lookup failed', { action: 'ghl_booking_webhook', errorMessage: findError.message })
    return NextResponse.json({ error: findError.message }, { status: 500 })
  }

  if (!primary) {
    // Unknown appointment — acknowledge so GHL doesn't retry indefinitely
    logger.warn('GHL booking webhook: no booking found', { action: 'ghl_booking_webhook', metadata: { ghlBookingId } })
    return NextResponse.json({ received: true, matched: false })
  }

  if (primary.status === event) {
    // Idempotent — already in this state
    return NextResponse.json({ received: true, matched: true, updated: 0 })
  }

  // ── Update the individual booking row ───────────────────────
  const { error: updateError } = await supabase
    .from('bookings')
    .update({ status: event })
    .eq('id', primary.id)

  if (updateError) {
    logger.error('GHL booking webhook: update failed', { action: 'ghl_booking_webhook', errorMessage: updateError.message })
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  logger.info('GHL booking webhook: updated', {
    action: 'ghl_booking_webhook',
    metadata: { event, bookingId: primary.id },
  })

  // ── Cancel the individual GHL appointment when cancelled ────
  if (event === 'cancelled' && primary.ghl_booking_id) {
    await cancelBooking(primary.ghl_booking_id).catch(() => {})
  }

  return NextResponse.json({ received: true, matched: true, updated: 1 })
}
