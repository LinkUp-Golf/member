export const dynamic = 'force-dynamic'

// POST /api/host/events/[id]/proof — upload a photo proving the event ran. The
// event must have occurred (completed or already pending approval). Uploading
// moves it to pending_credit_approval and notifies admins to review. Reuses the
// existing post-media storage bucket.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withHostAuth, type HostAuthContext } from '@/lib/auth/with-host-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { sendPushToAdmins, NotificationTemplates } from '@/lib/push'
import { logger } from '@/lib/logger'

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_BYTES = 10 * 1024 * 1024

const todayISO = () => new Date().toISOString().slice(0, 10)

// Proof makes sense once the event has occurred: any completed/awaiting-approval
// event, or an upcoming one whose date has already arrived (so the host isn't
// blocked waiting for the daily completion cron on the event day itself).
function canProof(status: string, eventDate: string): boolean {
  if (status === 'completed' || status === 'pending_credit_approval') return true
  if (status === 'upcoming' && eventDate <= todayISO()) return true
  return false
}

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
    if (!canProof(event.status, event.event_date)) {
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

    // Move to awaiting-approval unless it already is.
    if (event.status !== 'pending_credit_approval') {
      await admin.from('hosted_events').update({ status: 'pending_credit_approval' }).eq('id', id)
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
