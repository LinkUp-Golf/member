'use client'

// Propose a golf club that isn't on LinkUp yet.
//
// Hosting is offered at listed venues, and for good reason: a round's dates
// come from the club's own calendar, so a club we've never heard of has no days
// to pick. But "listed venues only" left a host whose club isn't here with
// nowhere to say so — the ask fell outside the product entirely.
//
// So this proposes the club rather than the round. It creates a `pending`
// course (POST /api/courses/request) that lands in the admin Courses queue, and
// hands the caller back a real course id. From there both host surfaces treat
// it as an ordinary venue that happens not to be set up yet: it's selectable,
// labelled pending, and its date picker says the LinkUp team has to finish
// setting it up before rounds can be listed.
//
// A host proposing one is granted it as a venue by the route, so it's in their
// list next time too.

import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Spinner } from '@/components/ui/Loading'

/** A proposed club, as the route returns it. */
export interface ProposedVenue {
  id: string
  name: string
  city: string
  approval_status: string
}

export default function AddVenueControl({
  onAdded,
  disabled = false,
  className,
}: {
  /**
   * The club, once it exists. `alreadyRequested` is true when someone had
   * already proposed the same club and the existing pending course was reused —
   * worth saying, since the caller's copy would otherwise claim it's new.
   */
  onAdded: (venue: ProposedVenue, alreadyRequested: boolean) => void
  disabled?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [website, setWebsite] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function close() {
    setOpen(false)
    setName('')
    setWebsite('')
    setError(null)
  }

  async function submit() {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Enter the golf club name.')
      return
    }
    setSubmitting(true)
    setError(null)

    const res = await fetch('/api/courses/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed, website: website.trim() || null }),
    })
    const json = await res.json().catch(() => ({}))
    setSubmitting(false)

    if (!res.ok || !json.course) {
      setError(json.error ?? 'Could not add the club. Try again.')
      return
    }

    onAdded(json.course as ProposedVenue, json.alreadyRequested === true)
    close()
  }

  if (!open) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={
          className ??
          'focus-ring inline-flex items-center gap-1.5 text-xs font-semibold text-green-800 hover:text-green-900 disabled:opacity-50'
        }
      >
        <Plus className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={2.2} />
        Can&apos;t find your club? Add it
      </button>
    )
  }

  return (
    <div className="rounded-xl border border-green-900/15 bg-white p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold text-green-950">Add a club we don&apos;t have yet</p>
        <button
          type="button"
          onClick={close}
          aria-label="Cancel adding a club"
          className="focus-ring -mt-0.5 -mr-0.5 p-0.5 rounded text-green-900/35 hover:text-green-900/70"
        >
          <X className="w-3.5 h-3.5" strokeWidth={2.2} />
        </button>
      </div>

      <input
        // Not a <form>: both callers already sit inside one, and a nested form
        // is invalid HTML — Enter here would submit theirs.
        className="input text-sm"
        placeholder="Golf club name"
        value={name}
        onChange={e => { setName(e.target.value); setError(null) }}
        disabled={submitting}
        maxLength={120}
      />
      <input
        className="input text-sm"
        placeholder="Club website (optional, but it speeds us up)"
        value={website}
        onChange={e => { setWebsite(e.target.value); setError(null) }}
        disabled={submitting}
        maxLength={200}
      />

      {error && <p className="text-xs text-red-500">{error}</p>}

      <p className="text-[11px] text-green-900/45 leading-snug">
        We&apos;ll set the club up — calendar, rate and all — before rounds can be
        listed there. You&apos;ll see it as pending until then.
      </p>

      <button
        type="button"
        onClick={submit}
        disabled={submitting || !name.trim()}
        className="btn btn-outline btn-sm w-full justify-center disabled:opacity-50"
      >
        {submitting ? <Spinner className="w-3.5 h-3.5 text-green-800" /> : 'Add club'}
      </button>
    </div>
  )
}
