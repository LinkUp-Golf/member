export const dynamic = 'force-dynamic'

// POST /api/admin/hosted-events/[id]/credits — approve or reject the host's
// credit for an event that's awaiting approval.
//   approve → award_host_event_credit RPC writes the 'earned' ledger row and
//             flips the event to credits_awarded, in one transaction. Takes an
//             optional amount: omitted, the host is credited the rate the event
//             was listed at; supplied, the admin's figure wins.
//   reject  → back to 'completed' so the host can upload fresh proof.
//
// Approving is also when the proof photo is copied into the GHL media library.
// It used to be mirrored the moment the host uploaded, which put every attempt
// over there — including the ones they replaced and the ones an admin sent back,
// none of which LinkUp keeps a row for afterwards. Doing it here means one file
// per credited round, and it's the photo the credit was actually paid on.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { sanitiseText } from '@/lib/validation'
import { sendPushToMember, NotificationTemplates } from '@/lib/push'
import { mirrorProofToGhl } from '@/lib/hosts/proofs'
import { logger } from '@/lib/logger'
import type { AuthContext } from '@/lib/auth/types'

// Same ceiling the manual adjustment route uses — a typo'd amount is far more
// likely than a genuine award this size.
const MAX_AWARD = 1_000_000

export const POST = withAuth(
  async (req: NextRequest, ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing event id' }, { status: 400 })

    const body = await req.json().catch(() => ({})) as {
      action?: 'approve' | 'reject'
      reason?: string
      amount?: number | string
      note?: string
    }
    if (body.action !== 'approve' && body.action !== 'reject') {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    const admin = createAdminClient()

    // event_date and the course name go into the mirrored file's name; the proof
    // itself is what gets mirrored once the award lands.
    const { data: event } = await admin
      .from('hosted_events')
      .select('id, status, member_guest_rate, event_date, course:courses(name), host:hosts(member_id)')
      .eq('id', id)
      .maybeSingle()

    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    if (event.status !== 'pending_credit_approval') {
      return NextResponse.json({ error: 'This event is not awaiting credit approval.' }, { status: 409 })
    }

    const host = Array.isArray(event.host) ? event.host[0] : event.host

    // ---- Reject ----------------------------------------------
    if (body.action === 'reject') {
      const reason = body.reason?.trim() ?? ''
      if (!reason) return NextResponse.json({ error: 'A reason is required' }, { status: 400 })

      // Persist the decision, not just the status rewind. The reason used to live
      // only inside a best-effort push, so a second admin couldn't see that a
      // first had already rejected this proof, and the host's re-upload arrived
      // with no history. The takedown path already records all three fields.
      const reviewedAt = new Date().toISOString()
      const { data: reverted, error } = await admin
        .from('hosted_events')
        .update({
          status: 'completed',
          rejection_reason: reason,
          reviewed_by: ctx.userId,
          reviewed_at: reviewedAt,
        })
        .eq('id', id)
        .eq('status', 'pending_credit_approval')
        .select('id')
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      // Another admin already acted in the race window (0 rows matched).
      if (!reverted || reverted.length === 0) {
        return NextResponse.json({ error: 'This event is not awaiting credit approval.' }, { status: 409 })
      }

      if (host?.member_id) {
        void sendPushToMember(host.member_id, NotificationTemplates.hostCreditRejected(reason)).catch(() => {})
      }
      logger.info('Hosted event credit rejected', {
        action: 'host.event.credit.rejected', userId: ctx.userId, metadata: { event_id: id },
      })

      try {
        await admin.from('admin_audit_log').insert({
          admin_id: ctx.userId,
          action: 'hosted_events.credit.rejected',
          target_type: 'hosted_event',
          target_id: id,
          payload: { reason },
        })
      } catch { /* table may not exist yet */ }

      return NextResponse.json({ ok: true, status: 'completed' })
    }

    // ---- Approve ---------------------------------------------
    // No amount means "credit the rate the event was listed at", which is what
    // approving used to mean unconditionally. An empty string counts as no
    // amount — the form sends one when the admin clears the field.
    const rawAmount = typeof body.amount === 'string' ? body.amount.trim() : body.amount
    let customAmount: number | null = null
    if (rawAmount !== undefined && rawAmount !== null && rawAmount !== '') {
      customAmount = Number(rawAmount)
      if (!Number.isFinite(customAmount) || customAmount <= 0) {
        return NextResponse.json({ error: 'Enter a credit amount greater than zero.' }, { status: 400 })
      }
      if (customAmount > MAX_AWARD) {
        return NextResponse.json({ error: 'That amount is too large.' }, { status: 400 })
      }
    }

    const note = typeof body.note === 'string' && body.note.trim()
      ? sanitiseText(body.note.trim())
      : null

    const { data: ledgerRow, error } = await admin.rpc('award_host_event_credit', {
      p_event_id: id,
      p_created_by: ctx.userId,
      p_amount: customAmount,
      p_note: note,
    })

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'Credit for this event has already been awarded.' }, { status: 409 })
      }
      if (error.message?.startsWith('EVENT_NOT_PENDING_APPROVAL')) {
        return NextResponse.json({ error: 'This event is not awaiting credit approval.' }, { status: 409 })
      }
      if (error.message?.startsWith('INVALID_AMOUNT')) {
        return NextResponse.json({ error: 'Enter a credit amount greater than zero.' }, { status: 400 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // A composite-returning function may come back as the row or as a
    // single-element array depending on how PostgREST resolves it.
    const row = Array.isArray(ledgerRow) ? ledgerRow[0] : ledgerRow
    const amount = Number(row?.amount ?? event.member_guest_rate)

    // Copy the approved photo to GHL. After the award on purpose: the credit is
    // already committed by the RPC above, so a GHL problem costs the copy and
    // nothing else. Awaited rather than backgrounded because a serverless
    // function can be frozen the moment it responds.
    const { data: proofRow } = await admin
      .from('hosted_event_proofs')
      .select('id, image_url')
      .eq('hosted_event_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (proofRow) {
      const course = Array.isArray(event.course) ? event.course[0] : event.course
      await mirrorProofToGhl({
        admin,
        proof: proofRow as { id: string; image_url: string },
        courseName: (course as { name: string } | null)?.name ?? null,
        eventDate: event.event_date as string,
        actorId: ctx.userId,
      })
    }
    if (host?.member_id) {
      void sendPushToMember(host.member_id, NotificationTemplates.hostCreditApproved(amount)).catch(() => {})
    }

    logger.info('Hosted event credit approved', {
      action: 'host.event.credit.approved',
      userId: ctx.userId,
      metadata: {
        event_id: id,
        amount,
        // Worth being able to find later: an award that didn't match the rate
        // the host listed is the one someone will ask about.
        listed_rate: Number(event.member_guest_rate),
        overridden: customAmount !== null && customAmount !== Number(event.member_guest_rate),
      },
    })

    // The money-touching admin surfaces were the only ones with no queryable
    // record of who did what — every other admin action writes admin_audit_log.
    try {
      await admin.from('admin_audit_log').insert({
        admin_id: ctx.userId,
        action: 'hosted_events.credit.awarded',
        target_type: 'hosted_event',
        target_id: id,
        payload: {
          amount,
          listed_rate: Number(event.member_guest_rate),
          overridden: customAmount !== null && customAmount !== Number(event.member_guest_rate),
          note,
        },
      })
    } catch { /* table may not exist yet */ }

    return NextResponse.json({ ok: true, status: 'credits_awarded', amount })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
