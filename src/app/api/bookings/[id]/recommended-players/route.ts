export const dynamic = 'force-dynamic'

// ============================================================
// GET  /api/bookings/[id]/recommended-players
// POST /api/bookings/[id]/recommended-players  { memberId, action: 'ping' | 'invite' }
//
// The members who cancelled out of this same event (venue and day), and the
// players from the booker's recent cancelled rounds, recommended on a round
// they've booked (see src/lib/bookings/recommended-players.ts).
//
// 'ping' asks one of them to come and book: a direct message from the booker,
// plus a push and an email. The pings waiting on a round may not outnumber the
// spots the day has open, so the route refuses one past that.
//
// 'invite' follows the booker adding them outright through
// POST /api/bookings/[id]/players, which holds the spot and sends its own
// "you've been added" push — this only sends the direct message, and only
// once they're actually on the round.
//
// Booker only, upcoming rounds only, and only members the recommendation
// actually names: the route is not a way to message anyone about anything.
// ============================================================

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { format } from 'date-fns'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { NotificationTemplates } from '@/lib/push'
import { notifyMember, kept } from '@/lib/notify'
import { openSpotsByDate } from '@/lib/bookings/availability'
import { loadRecommendations, pingsRemaining } from '@/lib/bookings/recommended-players'
import { sendDirectMessage } from '@/lib/messaging/direct'
import { formatTeeTime } from '@/lib/utils'
import type { AuthContext } from '@/lib/auth/types'
import type { Course } from '@/types'

type AdminClient = ReturnType<typeof createAdminClient>

async function loadOwnUpcomingBooking(admin: AdminClient, id: string, memberId: string) {
  const { data: booking } = await admin
    .from('bookings')
    .select('id, member_id, course_id, booking_date, tee_time, status, created_at')
    .eq('id', id)
    .single()
  if (!booking || booking.member_id !== memberId) {
    return { ok: false as const, response: NextResponse.json({ error: 'Booking not found' }, { status: 404 }) }
  }
  if (booking.status === 'cancelled') {
    return { ok: false as const, response: NextResponse.json({ error: 'This booking has been cancelled.' }, { status: 409 }) }
  }
  if (booking.booking_date < new Date().toISOString().slice(0, 10)) {
    return { ok: false as const, response: NextResponse.json({ error: 'This booking has already passed.' }, { status: 409 }) }
  }
  return { ok: true as const, booking }
}

async function openSpotsFor(admin: AdminClient, courseId: string, date: string) {
  const { data: course } = await admin.from('courses').select('*').eq('id', courseId).single()
  if (!course) return { course: null, openSpots: 0 }
  // A GHL failure reads as no spots: refusing a ping is safer than promising
  // one the day can't hold.
  const open = await openSpotsByDate(admin, course as Course, [date]).catch(() => new Map<string, number>())
  return { course: course as Course, openSpots: open.get(date) ?? 0 }
}

export const GET = withAuth(async (
  _req: NextRequest,
  ctx: AuthContext,
  routeCtx?: { params: Record<string, string> },
) => {
  const id = routeCtx?.params?.['id']
  if (!id) return NextResponse.json({ error: 'Missing booking id' }, { status: 400 })

  const admin = createAdminClient()
  const loaded = await loadOwnUpcomingBooking(admin, id, ctx.userId)
  if (!loaded.ok) return loaded.response
  const { booking } = loaded

  const { recommended, waitingPings } = await loadRecommendations(admin, booking)
  if (recommended.length === 0) {
    return NextResponse.json({ players: [], openSpots: 0, pingsLeft: 0 })
  }

  const { openSpots } = await openSpotsFor(admin, booking.course_id, booking.booking_date)
  return NextResponse.json({
    players: recommended,
    openSpots,
    pingsLeft: pingsRemaining(openSpots, waitingPings),
  })
})

export const POST = withAuth(async (
  req: NextRequest,
  ctx: AuthContext,
  routeCtx?: { params: Record<string, string> },
) => {
  const id = routeCtx?.params?.['id']
  if (!id) return NextResponse.json({ error: 'Missing booking id' }, { status: 400 })

  const body = await req.json().catch(() => null) as { memberId?: unknown; action?: unknown } | null
  const memberId = typeof body?.memberId === 'string' ? body.memberId : null
  const action = body?.action === 'invite' ? 'invite' : body?.action === 'ping' ? 'ping' : null
  if (!memberId || !action) {
    return NextResponse.json({ error: 'memberId and action (ping or invite) are required' }, { status: 400 })
  }

  const admin = createAdminClient()
  const loaded = await loadOwnUpcomingBooking(admin, id, ctx.userId)
  if (!loaded.ok) return loaded.response
  const { booking } = loaded

  const { data: sender } = await admin
    .from('members')
    .select('first_name, messaging_muted_until')
    .eq('id', ctx.userId)
    .single()
  if (sender?.messaging_muted_until && new Date(sender.messaging_muted_until) > new Date()) {
    return NextResponse.json(
      { error: 'Your messaging has been temporarily restricted. Contact an admin for help.' },
      { status: 403 },
    )
  }

  const { course, openSpots } = await openSpotsFor(admin, booking.course_id, booking.booking_date)
  const courseName = course?.name ?? 'the course'
  const dateLabel = format(new Date(`${booking.booking_date}T12:00:00`), 'EEEE, MMMM d')
  const timeLabel = formatTeeTime(booking.tee_time)

  let message: string
  if (action === 'invite') {
    // The add-players route already put them on the round; confirm it did.
    const { count } = await admin
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('member_id', ctx.userId)
      .eq('created_at', booking.created_at)
      .eq('player_member_id', memberId)
      .neq('status', 'cancelled')
    if (!count) {
      return NextResponse.json({ error: "They aren't on this booking yet." }, { status: 409 })
    }
    message = `I've added you to my round at ${courseName} on ${dateLabel} at ${timeLabel}. See you there!`
  } else {
    const { recommended, waitingPings } = await loadRecommendations(admin, booking)
    const target = recommended.find(p => p.memberId === memberId)
    if (!target) {
      return NextResponse.json({ error: "That player isn't one of your recommendations for this round." }, { status: 404 })
    }
    if (target.pinged) {
      return NextResponse.json({ error: 'You already pinged them about this round.' }, { status: 409 })
    }
    if (pingsRemaining(openSpots, waitingPings) < 1) {
      return NextResponse.json(
        {
          error: openSpots === 0
            ? 'There are no open spots left that day.'
            : `You've pinged as many players as there are open spots (${openSpots}).`,
        },
        { status: 409 },
      )
    }
    message = `I'm playing ${courseName} on ${dateLabel} at ${timeLabel} and there's a spot open — want to join? Book it on LinkUp under Book.`
  }

  // Recorded before the message goes, and unique per round and member, so two
  // taps can't both pass the count above and both send.
  const { error: pingError } = await admin
    .from('booking_player_pings')
    .insert({ booking_id: booking.id, member_id: memberId, pinged_by: ctx.userId, kind: action })
  if (pingError) {
    const duplicate = pingError.code === '23505'
    if (!(duplicate && action === 'invite')) {
      return NextResponse.json(
        { error: duplicate ? 'You already pinged them about this round.' : pingError.message },
        { status: duplicate ? 409 : 500 },
      )
    }
    // Pinged earlier and now added outright: the row becomes an invite.
    await admin
      .from('booking_player_pings')
      .update({ kind: 'invite' })
      .eq('booking_id', booking.id)
      .eq('member_id', memberId)
  }

  const sent = await sendDirectMessage(admin, {
    fromId: ctx.userId,
    toId: memberId,
    body: message,
    courseId: booking.course_id,
  })
  if ('error' in sent) {
    if (action === 'ping') {
      // Nothing reached them, so it shouldn't use up a spot.
      await admin.from('booking_player_pings').delete().eq('booking_id', booking.id).eq('member_id', memberId)
    }
    return NextResponse.json({ error: sent.error }, { status: 500 })
  }

  // An invite has already been announced by the add-players route.
  if (action === 'ping') {
    void kept(
      notifyMember(
        memberId,
        NotificationTemplates.playerPinged(sender?.first_name ?? 'A member', courseName, dateLabel, timeLabel),
      ).catch(() => {}),
    )
  }

  const { waitingPings } = await loadRecommendations(admin, booking)
  return NextResponse.json({
    ok: true,
    conversationId: sent.conversationId,
    pingsLeft: pingsRemaining(openSpots, waitingPings),
  })
})
