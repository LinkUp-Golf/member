export const dynamic = 'force-dynamic'

// POST /api/host/events/[id]/proof — upload a photo proving the event ran. The
// event must have occurred (completed or already pending approval). Uploading
// moves it to pending_credit_approval and notifies admins to review. Reuses the
// existing post-media storage bucket.
//
// The photo is also mirrored into the GHL media library, so it sits with the
// rest of the team's material rather than only inside this app. Supabase stays
// the copy the app renders and the one credit approval depends on; the GHL
// upload is best-effort and never blocks the host.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withHostAuth, type HostAuthContext } from '@/lib/auth/with-host-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { canUploadProof } from '@/lib/hosts/events'
import { uploadMediaToGhl } from '@/lib/ghl/client'
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
      .select('id, image_url')
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
    if (event.status === 'completed') {
      await admin.from('hosted_events').update({ status: 'pending_credit_approval' }).eq('id', id)
    }

    // Mirror into the GHL media library. Awaited (with its own timeout) rather
    // than fired and forgotten, because a serverless function can be frozen the
    // moment it responds — a backgrounded upload would silently not happen.
    // Everything the host needs is already committed above, so a null here
    // costs the GHL copy and nothing else.
    const course0 = Array.isArray(event.course) ? event.course[0] : event.course
    const ghlName = `linkup-proof-${(course0?.name ?? 'event').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${event.event_date}-${proof.id.slice(0, 8)}.${ext}`

    const media = await uploadMediaToGhl({ bytes, fileName: ghlName, contentType: file.type })
    if (media) {
      const { error: linkError } = await admin
        .from('hosted_event_proofs')
        .update({ ghl_media_id: media.fileId, ghl_media_url: media.url })
        .eq('id', proof.id)
      if (linkError) {
        // The file is in GHL either way; we've just lost the pointer to it.
        logger.warn('Could not record the GHL media reference', {
          action: 'host.event.proof.ghl_link', userId: ctx.userId,
          metadata: { proof_id: proof.id, ghl_file_id: media.fileId, error: linkError.message },
        })
      } else {
        proof.ghl_media_id = media.fileId
        proof.ghl_media_url = media.url
      }
    }

    // Supersede prior proof(s): remove the old rows and their blobs (best-effort).
    const stale = (priorProofs ?? []).filter(p => p.id !== proof.id)
    if (stale.length) {
      await admin.from('hosted_event_proofs').delete().in('id', stale.map(p => p.id))
      const paths = stale
        .map(p => { try { return new URL(p.image_url).pathname.replace(/^\/storage\/v1\/object\/public\/post-media\//, '') } catch { return null } })
        .filter((p): p is string => !!p)
      if (paths.length) await admin.storage.from('post-media').remove(paths)
    }

    const course = Array.isArray(event.course) ? event.course[0] : event.course
    void sendPushToAdmins(
      NotificationTemplates.hostedEventProofSubmitted(ctx.host.name, course?.name ?? 'a course', event.event_date)
    ).catch(() => {})

    logger.info('Hosted event proof uploaded', {
      action: 'host.event.proof.uploaded',
      userId: ctx.userId,
      metadata: { event_id: id, proof_id: proof.id },
    })

    return NextResponse.json({ proof, status: 'pending_credit_approval' }, { status: 201 })
  }
)
