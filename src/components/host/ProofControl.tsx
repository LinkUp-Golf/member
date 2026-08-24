'use client'

// Upload, replace, or remove the photo proving a hosted round ran.
//
// Shared by the event list and the event's own page, because both need the same
// things and must not disagree about any of them: what the button is called
// (which depends on whether a proof is already in, not on the status), what
// files are allowed, what happens after a successful send, and how removing
// asks before it does anything.
//
// Replacing and removing are both normal actions here, not recovery paths. The
// photo is a draft until an admin decides on the credit, so a host can swap it
// while the event waits, remove it if they sent the wrong one, and try again if
// it comes back.
//
// Removing asks first. It destroys the file, and unlike replacing it leaves the
// host with nothing — a mis-tap next to "Replace proof" should not silently undo
// their submission.

import { useRef, useState } from 'react'
import { proofState, type ProofNoteTone } from '@/lib/hosts/events'
import type { HostedEvent } from '@/types'

/** Kept next to the control so both screens colour a note the same way. */
export const PROOF_NOTE_CLASS: Record<ProofNoteTone, string> = {
  pending: 'text-amber-600',
  rejected: 'text-red-600',
  sent: 'text-green-700',
}

const ALLOWED = /^image\/(jpeg|png|webp)$/
const MAX_BYTES = 10 * 1024 * 1024

/** The proof currently on an event, newest first. */
export function currentProof(event: HostedEvent) {
  const proofs = event.proofs ?? []
  if (proofs.length === 0) return null
  return [...proofs].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))[0]
}

/** proofState for an event, reading the proof list the API now sends along. */
export function eventProofState(event: HostedEvent) {
  return proofState({
    status: event.status,
    eventDate: event.event_date,
    hasProof: (event.proofs?.length ?? 0) > 0,
    rejectionReason: event.rejection_reason ?? null,
  })
}

export default function ProofControl({
  event,
  onDone,
  onToast,
  variant = 'gold',
}: {
  event: HostedEvent
  onDone: () => void
  onToast: (msg: string, ok?: boolean) => void
  /** 'outline' where the button sits inside a card that already draws attention. */
  variant?: 'gold' | 'outline'
}) {
  const [uploading, setUploading] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const { label, hasProof } = eventProofState(event)
  const busy = uploading || removing

  async function upload(file: File) {
    if (!ALLOWED.test(file.type)) {
      onToast('Use a JPG, PNG, or WebP image.', false)
      return
    }
    if (file.size > MAX_BYTES) {
      onToast('Image must be under 10 MB.', false)
      return
    }
    setUploading(true)
    const data = new FormData()
    data.append('file', file)
    const res = await fetch(`/api/host/events/${event.id}/proof`, { method: 'POST', body: data })
    const json = await res.json().catch(() => ({}))
    setUploading(false)
    if (!res.ok) {
      onToast(json.error ?? 'Upload failed.', false)
      return
    }
    // Say which of the two things just happened — a host who meant to replace a
    // photo needs to know the new one landed, not that "proof was submitted".
    onToast(hasProof ? 'Proof replaced.' : 'Proof submitted for approval.')
    onDone()
  }

  async function remove() {
    if (busy) return
    setRemoving(true)
    const res = await fetch(`/api/host/events/${event.id}/proof`, { method: 'DELETE' })
    const json = await res.json().catch(() => ({}))
    setRemoving(false)
    setConfirmingRemove(false)
    if (!res.ok) {
      onToast(json.error ?? 'Could not remove that proof.', false)
      // The refusal may be news — an admin approving the credit mid-look closes
      // the window. Re-read so the buttons match what the server will now allow.
      onDone()
      return
    }
    onToast('Proof removed.')
    onDone()
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0]
          if (f) upload(f)
          // Cleared so picking the same file twice still fires a change.
          e.target.value = ''
        }}
      />
      {confirmingRemove ? (
        /* Replaces the pair rather than sitting beside them: two buttons and a
           question is all this row should be asking while it's open. */
        <span className="inline-flex items-center gap-2">
          <span className="text-xs text-red-700">Remove this photo?</span>
          <button
            onClick={() => setConfirmingRemove(false)}
            disabled={busy}
            className="btn btn-outline btn-sm"
          >
            Keep it
          </button>
          <button
            onClick={remove}
            disabled={busy}
            className="btn btn-sm bg-red-600 text-white"
          >
            {removing ? 'Removing…' : 'Remove'}
          </button>
        </span>
      ) : (
        <>
          <button
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className={`btn btn-sm ${variant === 'gold' ? 'btn-gold' : 'btn-outline'}`}
          >
            {uploading ? (hasProof ? 'Replacing…' : 'Uploading…') : label}
          </button>
          {hasProof && (
            /* Quieter than the two real buttons around it — removing is the
               least likely thing a host came here to do. */
            <button
              onClick={() => setConfirmingRemove(true)}
              disabled={busy}
              className="text-xs font-medium text-gray-400 hover:text-red-600 px-1"
            >
              Remove
            </button>
          )}
        </>
      )}
    </>
  )
}
