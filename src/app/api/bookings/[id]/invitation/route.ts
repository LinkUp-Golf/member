export const dynamic = 'force-dynamic'

// ============================================================
// An added player's invitation to a round.
//
//   GET  /api/bookings/[id]/invitation
//        → what the invitation screen shows: the round, who invited them,
//          who's paying, and whether it can still be answered.
//
//   POST /api/bookings/[id]/invitation   body { response: 'accept' | 'decline' }
//        → records the answer. A decline cancels the row, which frees the
//          seat, and cancels its GHL appointment. The booker hears either way.
//
// Only the invited player — the row's player_member_id — may read or answer
// it. See @/lib/bookings/invitations for the rules.
// ============================================================

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { format } from 'date-fns'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { cancelBooking } from '@/lib/ghl/client'
import { NotificationTemplates } from '@/lib/push'
import { notifyMember } from '@/lib/notify'
import { nameOrEmail } from '@/lib/utils'
import { validateUUID } from '@/lib/validation'
import { logger } from '@/lib/logger'
import { AVIARA_TIMEZONE } from '@/lib/constants'
import {
  canRespondToInvite,
  isInviteResponse,
  type InviteStatus,
} from '@/lib/bookings/invitations'
import type { AuthContext } from '@/lib/auth/types'

type RouteCtx = { params: Record<string, string> }

const SELECT =
  'id, member_id, player_member_id, course_id, booking_date, tee_time, status, ghl_booking_id, paid_by_booker, invite_status, ' +
  'booker:members!bookings_member_id_fkey(first_name, last_name, email, ghl_contact_id), ' +
  'course:courses!bookings_course_id_fkey(name, city, state, address, timezone)'

interface InvitationRow {
  id: string
  member_id: string
  player_member_id: string | null
  course_id: string
  booking_date: string
  tee_time: string
  status: string
  ghl_booking_id: string | null
  paid_by_booker: boolean
  invite_status: InviteStatus | null
  booker: { first_name: string | null; last_name: string | null; email: string | null; ghl_contact_id: string | null } | null
  course: { name: string; city: string | null; state: string | null; address: string | null; timezone: string | null } | null
}

async function loadInvitation(id: string | undefined, memberId: string) {
  if (!id || !validateUUID(id, 'booking id').valid) return null
  const admin = createAdminClient()
  const { data } = await admin
    .from('bookings')
    .select(SELECT)
    .eq('id', id)
    .eq('player_member_id', memberId)
    .maybeSingle()
  return (data as unknown as InvitationRow | null) ?? null
}

function todayAt(row: InvitationRow): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: row.course?.timezone || AVIARA_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

function bookerName(row: InvitationRow): string {
  const b = row.booker
  return nameOrEmail(`${b?.first_name ?? ''} ${b?.last_name ?? ''}`, b?.email ?? null) || 'A member'
}

export const GET = withAuth(async (_req: NextRequest, ctx: AuthContext, routeCtx?: RouteCtx) => {
  const row = await loadInvitation(routeCtx?.params?.['id'], ctx.memberId)
  if (!row) return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })

  return NextResponse.json({
    id: row.id,
    eventName: row.course?.name ?? 'LinkUp round',
    location: [row.course?.city, row.course?.state].filter(Boolean).join(', ') || null,
    bookingDate: row.booking_date,
    teeTime: row.tee_time,
    bookerName: bookerName(row),
    paidByBooker: row.paid_by_booker === true,
    inviteStatus: row.invite_status,
    bookingStatus: row.status,
    canRespond: canRespondToInvite({
      inviteStatus: row.invite_status,
      bookingStatus: row.status,
      bookingDate: row.booking_date,
      today: todayAt(row),
    }),
  })
})

export const POST = withAuth(async (req: NextRequest, ctx: AuthContext, routeCtx?: RouteCtx) => {
  const body = await req.json().catch(() => null) as { response?: unknown } | null
  if (!isInviteResponse(body?.response)) {
    return NextResponse.json({ error: "response must be 'accept' or 'decline'" }, { status: 400 })
  }
  const response = body.response

  const row = await loadInvitation(routeCtx?.params?.['id'], ctx.memberId)
  if (!row) return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })

  if (!canRespondToInvite({
    inviteStatus: row.invite_status,
    bookingStatus: row.status,
    bookingDate: row.booking_date,
    today: todayAt(row),
  })) {
    return NextResponse.json({ error: 'This invitation can no longer be answered.' }, { status: 409 })
  }

  const admin = createAdminClient()
  const inviteStatus: InviteStatus = response === 'accept' ? 'accepted' : 'declined'

  // Guarded on 'pending' so a double tap or a second device can't answer twice.
  const { data: updated, error } = await admin
    .from('bookings')
    .update({
      invite_status: inviteStatus,
      invite_responded_at: new Date().toISOString(),
      ...(response === 'decline' ? { status: 'cancelled', cancellation_reason: 'Declined invitation' } : {}),
    })
    .eq('id', row.id)
    .eq('invite_status', 'pending')
    .select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!updated?.length) {
    return NextResponse.json({ error: 'This invitation has already been answered.' }, { status: 409 })
  }

  // A declined seat comes off the venue's calendar too. Best-effort, like every
  // GHL step after the database has the answer.
  if (response === 'decline' && row.ghl_booking_id) {
    await cancelBooking(row.ghl_booking_id, row.booker?.ghl_contact_id ?? undefined).catch(() => false)
  }

  // The booker hears the answer, under the player's name.
  const { data: player } = await admin
    .from('members')
    .select('first_name, last_name, email')
    .eq('id', ctx.memberId)
    .single()
  const playerName =
    nameOrEmail(`${player?.first_name ?? ''} ${player?.last_name ?? ''}`, player?.email ?? null) || 'A player'
  const eventName = row.course?.name ?? 'your round'
  const date = format(new Date(`${row.booking_date}T12:00:00`), 'EEEE, MMMM d')
  void notifyMember(
    row.member_id,
    response === 'accept'
      ? NotificationTemplates.bookingInviteAccepted(playerName, eventName, date)
      : NotificationTemplates.bookingInviteDeclined(playerName, eventName, date),
  ).catch(() => {})

  logger.info('Booking invitation answered', {
    action: 'booking.invite_response',
    userId: ctx.userId,
    metadata: { booking_id: row.id, response },
  })

  return NextResponse.json({ inviteStatus, bookingStatus: response === 'decline' ? 'cancelled' : row.status })
})
