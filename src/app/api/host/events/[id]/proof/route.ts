export const dynamic = 'force-dynamic'

// POST /api/host/events/[id]/proof — upload a photo proving the event ran. The
// event must have occurred (completed or already pending approval). Uploading
// moves it to pending_credit_approval and notifies admins to review. Reuses the
// existing post-media storage bucket.
//
// Re-uploading is a first-class action, not an edge case: this is a draft until
// an admin decides on it, so a host can replace the photo while the event waits
// for review, and again if it's sent back. Each upload supersedes the last —
// old row and old blob both go.
//
// Nothing is copied to GHL here. The mirror happens when the credit is approved
// (see mirrorProofToGhl, called from the admin credit route), so the media
// library gets one file per credited round rather than every attempt a host
// made, including the ones that were replaced or refused.
//
// DELETE /api/host/events/[id]/proof — take the photo back down. Same window as
// uploading: a host can withdraw a proof right up until the credit is approved,
// and doing so from the credit queue returns the event to 'completed' so it
// stops waiting on a decision about a photo that is no longer there.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withHostAuth, type HostAuthContext } from '@/lib/auth/with-host-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { canUploadProof } from '@/lib/hosts/events'
import { deleteProofs } from '@/lib/hosts/proofs'
import { sendPushToAdmins, NotificationTemplates } from '@/lib/push'
import { logger } from '@/lib/logger'

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_BYTES = 10 * 1024 * 1024

// Eligibility lives in lib/hosts/events so this route and the host UI can't
// disagree about when the upload button should exist.

export const POST = withHostAuth(
  async (req: NextRequest, ctx: HostAuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing event id' }, { status: 400 })

    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file field is required' }, { status: 400 })
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json({ error: 'Only JPEG, PNG, or WebP images are allowed' }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'Image must be 10 MB or smaller' }, { status: 400 })
    }

    const admin = createAdminClient()

    const { data: event } = await admin
      .from('hosted_events')
      .select('id, status, event_date, course:courses(name)')
      .eq('id', id)
      .eq('host_id', ctx.host.id)
      .maybeSingle()

    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    if (!canUploadProof(event.status, event.event_date)) {
      return NextResponse.json(
        { error: 'You can only upload proof once the event has taken place.' },
        { status: 409 }
      )
    }

    // Existing proofs to clean up after a successful replacement (one proof per
    // event for now — a new upload supersedes the old).
    const { data: priorProofs } = await admin
      .from('hosted_event_proofs')
      .select('id, image_url, ghl_media_id')
      .eq('hosted_event_id', id)

    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
    const objectPath = `host-proofs/${id}/${Date.now()}.${ext}`
    const bytes = await file.arrayBuffer()

    const { error: uploadError } = await admin.storage
      .from('post-media')
      .upload(objectPath, bytes, { contentType: file.type, upsert: false })
    if (uploadError) {
      return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
    }

    const { data: { publicUrl } } = admin.storage.from('post-media').getPublicUrl(objectPath)

    const { data: proof, error: insertError } = await admin
      .from('hosted_event_proofs')
      .insert({ hosted_event_id: id, image_url: publicUrl, uploaded_by: ctx.userId })
      .select()
      .single()
    if (insertError) {
      // Best-effort cleanup of the orphaned blob.
      await admin.storage.from('post-media').remove([objectPath]).catch(() => {})
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    // Move to awaiting-approval — but never out of `upcoming`.
    //
    // canUploadProof deliberately allows a same-day upload, so a host can submit
    // the moment the round finishes rather than waiting for the nightly
    // completion cron. Flipping the status here used to delist that still-live
    // event: it dropped out of member browse (which filters status='upcoming'),
    // new reservations started failing with EVENT_NOT_OPEN, members' cards flipped
    // to "Finished", and admins lost the ability to take it down (takedown only
    // accepts `upcoming`). The proof is stored either way, and the completion cron
    // moves the event to `completed` at 08:00 UTC — the credit queue picks it up
    // from there.
    let nextStatus = event.status
    if (event.status === 'completed') {
      const { error: statusError } = await admin
        .from('hosted_events')
        .update({
          status: 'pending_credit_approval',
          // A reason from an earlier rejection describes the photo that was just
          // replaced. Leaving it set kept "Proof not accepted" on screen next to
          // the new submission.
          rejection_reason: null,
        })
        .eq('id', id)
      if (!statusError) nextStatus = 'pending_credit_approval'
    }

    // Supersede prior proof(s) — same cleanup as removing one outright, which is
    // why it goes through the shared helper: rows, blobs, and the GHL copy that
    // proofs written before the mirror moved to approval still carry.
    const stale = (priorProofs ?? []).filter(p => p.id !== proof.id)
    await deleteProofs({ admin, proofs: stale, actorId: ctx.userId })

    const course = Array.isArray(event.course) ? event.course[0] : event.course
    void sendPushToAdmins(
      NotificationTemplates.hostedEventProofSubmitted(ctx.host.name, course?.name ?? 'a course', event.event_date)
    ).catch(() => {})

    logger.info('Hosted event proof uploaded', {
      action: 'host.event.proof.uploaded',
      userId: ctx.userId,
      metadata: { event_id: id, proof_id: proof.id, replaced: (priorProofs ?? []).length > 0 },
    })

    // The event's real status, not an assumed one: a same-day upload leaves it
    // 'upcoming' on purpose, and saying 'pending_credit_approval' here had the
    // client render "waiting on your credit" over an event still open for
    // reservations.
    return NextResponse.json({ proof, status: nextStatus }, { status: 201 })
  }
)

export const DELETE = withHostAuth(
  async (_req: NextRequest, ctx: HostAuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing event id' }, { status: 400 })

    const admin = createAdminClient()

    const { data: event } = await admin
      .from('hosted_events')
      .select('id, status, event_date')
      .eq('id', id)
      .eq('host_id', ctx.host.id)
      .maybeSingle()

    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

    // The same window as uploading. In particular this refuses credits_awarded:
    // that photo is the evidence the credit was paid against, and it is the one
    // copied into GHL — removing it would delete the record behind a payment.
    if (!canUploadProof(event.status, event.event_date)) {
      return NextResponse.json(
        { error: 'Proof can only be removed before your credit is approved.' },
        { status: 409 }
      )
    }

    const { data: proofs } = await admin
      .from('hosted_event_proofs')
      .select('id, image_url, ghl_media_id')
      .eq('hosted_event_id', id)

    if (!proofs || proofs.length === 0) {
      return NextResponse.json({ error: 'There\'s no proof to remove.' }, { status: 404 })
    }

    const { deleted } = await deleteProofs({ admin, proofs, actorId: ctx.userId })
    if (deleted === 0) {
      return NextResponse.json({ error: 'Could not remove that proof.' }, { status: 500 })
    }

    // An event awaiting a credit decision has nothing left to decide on, so it
    // leaves the queue. Without this an admin would open a pending review with no
    // photo in it and no way to clear it other than rejecting a host who had
    // already withdrawn. A same-day withdrawal leaves 'upcoming' alone — the
    // round is still live and listed, exactly as on upload.
    let nextStatus = event.status
    if (event.status === 'pending_credit_approval') {
      const { error: statusError } = await admin
        .from('hosted_events')
        .update({ status: 'completed' })
        .eq('id', id)
        .eq('status', 'pending_credit_approval')
      if (!statusError) nextStatus = 'completed'
    }

    logger.info('Hosted event proof removed', {
      action: 'host.event.proof.removed',
      userId: ctx.userId,
      metadata: { event_id: id, removed: deleted, status: nextStatus },
    })

    return NextResponse.json({ ok: true, status: nextStatus })
  }
)
