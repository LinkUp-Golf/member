export const dynamic = 'force-dynamic'

// ============================================================
// PATCH /api/admin/booking-requests/[id]
// Moderate a non-member guest booking (status 'awaiting_approval').
//
//   setup  → create/lookup the GHL contact from the guest's details,
//            create the GHL appointment, flip the booking to 'tentative',
//            and notify the booker.
//   reject → cancel the booking and notify the booker.
// ============================================================

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { createBooking, getContactByEmail, createContact, addTagToContact } from '@/lib/ghl/client'
import { ALL_ACCESS_TAGS } from '@/lib/ghl/tags'
import { resolveAviaraAppointmentIso } from '@/lib/ghl/booking-time'
import { syncMember } from '@/lib/sync'
import { sendPushToMember, NotificationTemplates } from '@/lib/push'
import { logger } from '@/lib/logger'
import { format } from 'date-fns'
import { AVIARA_TIMEZONE, AVIARA_ADDRESS } from '@/lib/constants'
import type { AuthContext } from '@/lib/auth/types'
import type { AdditionalPlayer, GHLContact } from '@/types'

const AVIARA_CALENDAR_ID = process.env.GHL_AVIARA_CALENDAR_ID ?? ''

type RequestAction = 'setup' | 'reject'

export const PATCH = withAuth(
  async (req: NextRequest, ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing booking id' }, { status: 400 })

    const body = await req.json().catch(() => ({})) as { action?: RequestAction }
    const action = body.action
    if (action !== 'setup' && action !== 'reject') {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    const admin = createAdminClient()

    const { data: booking, error: fetchError } = await admin
      .from('bookings')
      .select('id, member_id, booking_date, tee_time, guest_name, additional_players, status')
      .eq('id', id)
      .single()

    if (fetchError || !booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
    }

    if (booking.status !== 'awaiting_approval') {
      return NextResponse.json({ error: 'This guest has already been reviewed' }, { status: 409 })
    }

    const guest = (booking.additional_players?.[0] ?? {}) as Partial<AdditionalPlayer>
    const guestName =
      [guest.firstName, guest.lastName].filter(Boolean).join(' ').trim() ||
      booking.guest_name ||
      guest.email ||
      'Guest'
    const displayDate = format(new Date(`${booking.booking_date}T12:00:00`), 'EEEE, MMMM d')
    const displayTime = String(booking.tee_time).slice(0, 5)

    // ---- Reject -------------------------------------------------
    if (action === 'reject') {
      const { error } = await admin
        .from('bookings')
        .update({ status: 'cancelled', cancellation_reason: 'Non-member guest not approved' })
        .eq('id', id)
        .eq('status', 'awaiting_approval')

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })

      void sendPushToMember(
        booking.member_id,
        NotificationTemplates.nonMemberBookingRejected(guestName, displayDate, displayTime)
      ).catch(() => {})

      logger.info('Admin rejected non-member guest', {
        action: 'non_member_booking.rejected',
        userId: ctx.userId,
        metadata: { booking_id: id },
      })

      try {
        await admin.from('admin_audit_log').insert({
          admin_id: ctx.userId,
          action: 'non_member_booking.rejected',
          target_type: 'booking',
          target_id: id,
          payload: { member_id: booking.member_id, email: guest.email },
        })
      } catch { /* table may not exist yet */ }

      return NextResponse.json({ ok: true, status: 'rejected' })
    }

    // ---- Setup --------------------------------------------------
    if (!guest.email) {
      return NextResponse.json({ error: 'Guest is missing an email address' }, { status: 400 })
    }

    // Create the GHL contact + appointment first. If GHL fails, leave the booking
    // 'awaiting_approval' so the admin can retry instead of losing the guest.
    let ghlBookingId: string
    let contactId = ''
    try {
      const existing = await getContactByEmail(guest.email)
      contactId = existing?.id ?? (await createContact({
        firstName: guest.firstName ?? '',
        lastName: guest.lastName ?? '',
        email: guest.email,
        phone: guest.mobile || null,
      })) ?? ''
      if (!contactId) throw new Error('Could not resolve a GHL contact for the guest')

      // Tag the contact with the app's access/membership tags so the app
      // recognises them (and GHL membership workflows fire) before booking.
      for (const tag of ALL_ACCESS_TAGS) {
        await addTagToContact(contactId, tag)
      }

      const { startIso, endIso } = resolveAviaraAppointmentIso(booking.booking_date, booking.tee_time)
      ghlBookingId = await createBooking({
        calendarId: AVIARA_CALENDAR_ID,
        title: 'LinkUp @ Aviara',
        startTime: startIso,
        endTime: endIso,
        timezone: AVIARA_TIMEZONE,
        address: AVIARA_ADDRESS,
        contact: { id: contactId, email: guest.email, phone: guest.mobile || null },
      })
    } catch (err) {
      logger.error('Non-member setup — GHL booking failed', {
        action: 'non_member_booking.ghl_failed',
        userId: ctx.userId,
        metadata: { booking_id: id, error: String(err) },
      })
      return NextResponse.json(
        { error: 'Failed to create the appointment in GHL. Please try again.', detail: String(err) },
        { status: 502 }
      )
    }

    const { error: updateError } = await admin
      .from('bookings')
      .update({ status: 'tentative', ghl_booking_id: ghlBookingId })
      .eq('id', id)
      .eq('status', 'awaiting_approval')

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    // Register just this guest in the system — create their auth user if new, then
    // run the member sync for their tagged contact. Targeted (not a full GHL
    // re-sync) and best-effort: the booking is already set up.
    try {
      const ghlContact: GHLContact = {
        id: contactId,
        email: guest.email,
        firstName: guest.firstName ?? '',
        lastName: guest.lastName ?? '',
        phone: guest.mobile ?? '',
        tags: [...ALL_ACCESS_TAGS],
        customFields: [],
      }

      const { data: existingMember } = await admin
        .from('members')
        .select('id')
        .eq('email', guest.email.toLowerCase())
        .single()

      let memberUserId = existingMember?.id as string | undefined
      if (!memberUserId) {
        const { data: created, error: createErr } = await admin.auth.admin.createUser({
          email: guest.email,
          email_confirm: true,
          user_metadata: {
            ghl_contact_id: contactId,
            first_name: guest.firstName,
            last_name: guest.lastName,
          },
        })
        if (createErr || !created.user) {
          throw new Error(createErr?.message ?? 'Auth user creation failed')
        }
        memberUserId = created.user.id
      }

      await syncMember({ contact: ghlContact, userId: memberUserId, ctx: { supabase: admin } })
    } catch (err) {
      logger.error('Non-member setup — member sync failed (non-fatal)', {
        action: 'non_member_booking.sync_failed',
        userId: ctx.userId,
        metadata: { booking_id: id, error: String(err) },
      })
    }

    void sendPushToMember(
      booking.member_id,
      NotificationTemplates.nonMemberBookingApproved(guestName, displayDate, displayTime)
    ).catch(() => {})

    logger.info('Admin set up non-member guest', {
      action: 'non_member_booking.setup',
      userId: ctx.userId,
      metadata: { booking_id: id },
    })

    try {
      await admin.from('admin_audit_log').insert({
        admin_id: ctx.userId,
        action: 'non_member_booking.setup',
        target_type: 'booking',
        target_id: id,
        payload: { member_id: booking.member_id, email: guest.email, ghl_booking_id: ghlBookingId },
      })
    } catch { /* table may not exist yet */ }

    return NextResponse.json({ ok: true, status: 'setup' })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
