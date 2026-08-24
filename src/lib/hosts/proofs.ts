// ============================================================
// LinkUp Golf — Hosted event proof photos
// Server-only: reads Supabase Storage and talks to GHL.
//
// A proof lives in the post-media bucket, and that copy is the one the app
// renders and the one credit approval is decided on. GHL gets a copy so the
// photo sits alongside the rest of the team's material.
//
// The mirror runs when an admin APPROVES the credit, not when the host uploads.
// Uploading is a draft: a host can replace the photo as many times as they like
// while the event waits for review, and an admin can send one back. Mirroring at
// upload time meant every one of those attempts landed in the GHL media library
// permanently — the superseded ones with nothing left in LinkUp pointing at them,
// since replacing deletes the old row and blob. Waiting for approval means one
// file per credited round, and it is the photo the credit was actually paid on.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { deleteGhlMedia, uploadMediaToGhl } from '@/lib/ghl/client'
import { logger } from '@/lib/logger'

type AdminClient = SupabaseClient

export const PROOF_BUCKET = 'post-media'

const PUBLIC_PREFIX = `/storage/v1/object/public/${PROOF_BUCKET}/`

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

/**
 * The object path inside the bucket, from the public URL stored on the row.
 *
 * Only the path is stored anywhere — image_url is what the table holds — so both
 * deleting a superseded blob and reading one back for the GHL mirror have to go
 * through this. It was inline in the proof route's cleanup; a second caller is
 * what makes it worth naming.
 *
 * Returns null for anything that isn't one of our public bucket URLs, so a
 * malformed or foreign URL can't be turned into a storage operation.
 */
export function proofStoragePath(imageUrl: string): string | null {
  try {
    const { pathname } = new URL(imageUrl)
    if (!pathname.startsWith(PUBLIC_PREFIX)) return null
    const path = decodeURIComponent(pathname.slice(PUBLIC_PREFIX.length))
    return path || null
  } catch {
    return null
  }
}

/** Content type from the stored path's extension; images only. */
export function proofContentType(path: string): string | null {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return CONTENT_TYPES[ext] ?? null
}

/**
 * The GHL file name for a credited round's proof. Readable in the media library
 * without cross-referencing anything: club, date, and enough of the proof id to
 * stay unique.
 */
export function proofGhlFileName(params: {
  courseName: string | null
  eventDate: string
  proofId: string
  ext: string
}): string {
  const slug = (params.courseName ?? 'event')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `linkup-proof-${slug || 'event'}-${params.eventDate}-${params.proofId.slice(0, 8)}.${params.ext}`
}

/** A proof as the delete path needs it — the row, its blob, and any GHL copy. */
export interface DeletableProof {
  id: string
  image_url: string
  ghl_media_id?: string | null
}

/**
 * Delete proof rows and everything they point at.
 *
 * One helper for both ways a proof goes away — replaced by a new upload, or
 * removed outright — because they have to clean up identically and only one of
 * them used to. The row goes first: it is what the app reads, so a failure after
 * it means an orphaned file, while a failure before it would leave a row
 * pointing at bytes that are gone.
 *
 * The GHL copy is usually absent (the mirror only runs on credit approval, and
 * an approved event can't be edited), but proofs written before that change
 * carry one — and deleting the row without it would strand the file over there.
 *
 * Storage and GHL failures are logged, not raised: the proof is gone from the
 * host's point of view either way, and there is nothing useful they could do
 * about a leftover blob.
 */
export async function deleteProofs(params: {
  admin: AdminClient
  proofs: DeletableProof[]
  actorId?: string | null
}): Promise<{ deleted: number }> {
  const { admin, proofs } = params
  if (proofs.length === 0) return { deleted: 0 }

  const { error: rowError } = await admin
    .from('hosted_event_proofs')
    .delete()
    .in('id', proofs.map(p => p.id))

  if (rowError) {
    logger.warn('Could not delete proof rows', {
      action: 'host.event.proof.delete',
      userId: params.actorId ?? undefined,
      metadata: { proof_ids: proofs.map(p => p.id), error: rowError.message },
    })
    return { deleted: 0 }
  }

  const paths = proofs.map(p => proofStoragePath(p.image_url)).filter((p): p is string => !!p)
  if (paths.length) {
    const { error: blobError } = await admin.storage.from(PROOF_BUCKET).remove(paths)
    if (blobError) {
      logger.warn('Proof rows deleted but their images remain in storage', {
        action: 'host.event.proof.delete',
        userId: params.actorId ?? undefined,
        metadata: { paths, error: blobError.message },
      })
    }
  }

  // Legacy rows only — see above.
  for (const p of proofs) {
    if (p.ghl_media_id) await deleteGhlMedia(p.ghl_media_id)
  }

  return { deleted: proofs.length }
}

/**
 * Copy an approved proof into the GHL media library and record the handle.
 *
 * Entirely best-effort, and deliberately so: it runs after the credit has
 * already been awarded in its own transaction, so a GHL outage must cost the
 * copy and nothing else. Never throws.
 */
export async function mirrorProofToGhl(params: {
  admin: AdminClient
  proof: { id: string; image_url: string }
  courseName: string | null
  eventDate: string
  actorId?: string | null
}): Promise<{ mirrored: boolean }> {
  const { admin, proof } = params

  const path = proofStoragePath(proof.image_url)
  const contentType = path ? proofContentType(path) : null
  if (!path || !contentType) {
    logger.warn('Proof could not be mirrored to GHL — unrecognised image URL', {
      action: 'host.event.proof.ghl_mirror',
      userId: params.actorId ?? undefined,
      metadata: { proof_id: proof.id },
    })
    return { mirrored: false }
  }

  try {
    // Read it back out of storage rather than over the public URL: same bytes,
    // no round-trip through the CDN, and it works whether or not the bucket is
    // publicly reachable from this runtime.
    const { data: blob, error: downloadError } = await admin.storage.from(PROOF_BUCKET).download(path)
    if (downloadError || !blob) {
      logger.warn('Proof could not be read back for the GHL mirror', {
        action: 'host.event.proof.ghl_mirror',
        userId: params.actorId ?? undefined,
        metadata: { proof_id: proof.id, error: downloadError?.message ?? 'no body' },
      })
      return { mirrored: false }
    }

    const media = await uploadMediaToGhl({
      bytes: await blob.arrayBuffer(),
      fileName: proofGhlFileName({
        courseName: params.courseName,
        eventDate: params.eventDate,
        proofId: proof.id,
        ext: path.split('.').pop()?.toLowerCase() ?? 'jpg',
      }),
      contentType,
    })
    if (!media) return { mirrored: false }

    const { error: linkError } = await admin
      .from('hosted_event_proofs')
      .update({ ghl_media_id: media.fileId, ghl_media_url: media.url })
      .eq('id', proof.id)

    if (linkError) {
      // The file is in GHL either way; we've just lost the pointer to it.
      logger.warn('Could not record the GHL media reference', {
        action: 'host.event.proof.ghl_mirror',
        userId: params.actorId ?? undefined,
        metadata: { proof_id: proof.id, ghl_file_id: media.fileId, error: linkError.message },
      })
    }

    return { mirrored: true }
  } catch (err) {
    logger.warn('Proof GHL mirror failed', {
      action: 'host.event.proof.ghl_mirror',
      userId: params.actorId ?? undefined,
      errorMessage: err instanceof Error ? err.message : String(err),
      metadata: { proof_id: proof.id },
    })
    return { mirrored: false }
  }
}
