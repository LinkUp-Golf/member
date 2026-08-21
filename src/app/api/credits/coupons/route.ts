export const dynamic = 'force-dynamic'

// GET  /api/credits/coupons — the caller's balance and their credit codes.
// POST /api/credits/coupons — turn credit into a code they can use at checkout.
//
// One route for both places credit gets spent — a tee time awaiting payment and
// a hosted round — plus a plain wallet conversion with no bill attached. The
// difference between them is only which price the code is sized against, so the
// money handling stays in one place (lib/credits/coupons.ts) rather than being
// re-implemented per surface.
//
// Not under /api/host: the wallet belongs to the member, and paying for a round
// with credit is something a member does. A host who isn't a member can't spend
// at all (enforced in the RPC), so gating this on the host role would be both
// wrong and beside the point.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { canRedeemCredit, loadCreditSummary, loadMemberCoupons } from '@/lib/credits'
import { issueCreditCoupon, syncCreditCoupons, type CouponTarget } from '@/lib/credits/coupons'
import { UNPAID_BOOKING_STATUSES } from '@/lib/bookings/pending-payment'
import { bookingAmountDue } from '@/lib/bookings/price'
import { memberPrice } from '@/lib/hosts/events'
import type { AuthContext } from '@/lib/auth/types'

export const GET = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  const admin = createAdminClient()

  // GHL doesn't push coupon usage back to us, so a look at the wallet is one of
  // the moments we reconcile — but only when asked. Each open code costs a GHL
  // round-trip, and the surfaces that just need a balance (the Book screen, a
  // hosted event) shouldn't wait on that. The daily cron is the backstop.
  if (req.nextUrl.searchParams.get('sync') === '1') {
    await syncCreditCoupons({ admin, memberId: ctx.memberId, limit: 5 }).catch(() => {})
  }

  const [summary, coupons, canRedeem] = await Promise.all([
    loadCreditSummary(admin, ctx.memberId),
    loadMemberCoupons(admin, ctx.memberId),
    canRedeemCredit(admin, ctx.memberId),
  ])

  return NextResponse.json({ summary, coupons, canRedeem })
}, { skipGHLCheck: true })

export const POST = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const admin = createAdminClient()

  const bookingId = typeof body.booking_id === 'string' ? body.booking_id : null
  const hostedEventId = typeof body.hosted_event_id === 'string' ? body.hosted_event_id : null

  if (bookingId && hostedEventId) {
    return NextResponse.json(
      { error: 'A code covers one round — send a booking or an event, not both.' },
      { status: 400 }
    )
  }

  let target: CouponTarget

  if (bookingId) {
    // ---- Against a tee time awaiting payment ---------------------------
    const { data: booking } = await admin
      .from('bookings')
      .select('id, member_id, player_member_id, course_id, status, amount_charged, course:courses!bookings_course_id_fkey(cost_per_player)')
      .eq('id', bookingId)
      .maybeSingle()

    if (!booking) return NextResponse.json({ error: 'That booking no longer exists.' }, { status: 404 })

    // Whoever can press "Pay" can pay with credit: the member's own row, or a
    // row on a booking they made (a booker settles their guests' shares too).
    const isMine = booking.member_id === ctx.memberId || booking.player_member_id === ctx.memberId
    if (!isMine) return NextResponse.json({ error: 'That booking isn\'t yours to pay for.' }, { status: 403 })

    if (!UNPAID_BOOKING_STATUSES.includes(booking.status as typeof UNPAID_BOOKING_STATUSES[number])) {
      return NextResponse.json(
        { error: 'That round isn\'t awaiting payment right now.' },
        { status: 409 }
      )
    }

    const course = Array.isArray(booking.course) ? booking.course[0] : booking.course
    const price = bookingAmountDue({
      amount_charged: booking.amount_charged as number | null,
      cost_per_player: (course as { cost_per_player: number | null } | null)?.cost_per_player,
    })

    target = {
      kind: 'booking',
      bookingId: booking.id as string,
      courseId: (booking.course_id as string) ?? null,
      price,
    }
  } else if (hostedEventId) {
    // ---- Against a hosted round ----------------------------------------
    const { data: event } = await admin
      .from('hosted_events')
      .select('id, course_id, status, member_guest_rate')
      .eq('id', hostedEventId)
      .maybeSingle()

    if (!event) return NextResponse.json({ error: 'That event no longer exists.' }, { status: 404 })
    if (event.status !== 'upcoming') {
      return NextResponse.json({ error: 'That event isn\'t open right now.' }, { status: 409 })
    }

    // The spot comes first: a code is for a round they're actually playing, and
    // tying it to a reservation is what makes it attributable afterwards.
    const { data: reservation } = await admin
      .from('hosted_event_registrations')
      .select('id')
      .eq('hosted_event_id', hostedEventId)
      .eq('member_id', ctx.memberId)
      .eq('status', 'reserved')
      .maybeSingle()

    if (!reservation) {
      return NextResponse.json(
        { error: 'Reserve your spot first, then put your credit toward it.' },
        { status: 409 }
      )
    }

    target = {
      kind: 'hosted_event',
      hostedEventId: event.id as string,
      courseId: (event.course_id as string) ?? null,
      // What a member pays for a hosted round — the host's guest rate plus the
      // standard markup, the same figure the event screens show.
      price: memberPrice(Number(event.member_guest_rate)),
    }
  } else {
    // ---- A plain wallet conversion -------------------------------------
    if (body.amount == null || body.amount === '') {
      return NextResponse.json({ error: 'Enter how much credit to turn into a code.' }, { status: 400 })
    }
    target = { kind: 'general' }
  }

  const result = await issueCreditCoupon({
    admin,
    memberId: ctx.memberId,
    target,
    requested: body.amount,
    note: body.note,
    context: { source: target.kind },
  })

  if (!result.ok) {
    // shortfall lets the client say how much more credit the round needs,
    // rather than only that it can't be paid this way.
    return NextResponse.json(
      { error: result.error, shortfall: result.shortfall },
      { status: result.status }
    )
  }

  return NextResponse.json(
    {
      ok: true,
      coupon: result.coupon,
      summary: result.summary,
      existing: result.existing,
    },
    { status: result.existing ? 200 : 201 }
  )
})
