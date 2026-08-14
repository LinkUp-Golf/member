'use client'

// Admin: browse all hosted events, review proof, and approve or reject the
// host's credit. Rendered as a tab on the admin Hosts page.
//
// Two decisions live here, one per stage of an event's life:
//   upcoming                → take down a live event that shouldn't be listed
//                             (hosts publish without waiting for approval)
//   pending_credit_approval → approve or reject the host's credit after it ran

import { useState, useEffect, useCallback, useRef, memo } from 'react'
import { AdminCard, Badge } from '@/components/admin/AdminUI'
import { errorMessage } from '@/lib/errors/error-message'
import type { HostedEvent, HostedEventStatus } from '@/types'

const fmtMoney = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 })

const fmtDate = (d: string) =>
  new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

const STATUS_META: Record<HostedEventStatus, { label: string; colour: 'green' | 'gold' | 'red' | 'blue' | 'gray' }> = {
  pending_approval:        { label: 'Awaiting approval', colour: 'gold' },
  upcoming:                { label: 'Upcoming',         colour: 'green' },
  completed:               { label: 'Completed',        colour: 'blue' },
  pending_credit_approval: { label: 'Credit approval',  colour: 'gold' },
  credits_awarded:         { label: 'Credits awarded',  colour: 'green' },
  cancelled:               { label: 'Cancelled',        colour: 'red' },
}

const FILTERS: { key: string; label: string }[] = [
  // First because it's the queue that blocks a host: nothing they created is
  // visible to a single member until someone here approves it.
  { key: 'pending_approval', label: 'Awaiting approval' },
  { key: 'pending_credit_approval', label: 'Credit approval' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'completed', label: 'Completed' },
  { key: 'credits_awarded', label: 'Awarded' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: '', label: 'All' },
]

function hostLabel(e: HostedEvent) {
  const m = e.host?.member
  const person = m ? `${m.first_name} ${m.last_name}`.trim() : ''
  return e.host?.name || person || 'Host'
}

export default function HostedEventsAdmin({ onToast }: { onToast: (msg: string, ok?: boolean) => void }) {
  const [events, setEvents] = useState<HostedEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('pending_credit_approval')
  const [pendingCount, setPendingCount] = useState(0)
  const [truncated, setTruncated] = useState(false)
  const [search, setSearch] = useState('')
  // Bumped on every load; a response from an older request is discarded. Without
  // it, clicking two filters quickly could leave the slower response rendered
  // under the newer filter.
  const requestRef = useRef(0)

  const load = useCallback(async () => {
    const seq = ++requestRef.current
    setLoading(true)
    try {
      const qs = filter ? `?status=${filter}` : ''
      const res = await fetch(`/api/admin/hosted-events${qs}`)
      const json = await res.json().catch(() => ({}))
      if (seq !== requestRef.current) return
      if (res.ok) {
        setEvents(Array.isArray(json.events) ? json.events : [])
        setPendingCount(json.pendingCount ?? 0)
        setTruncated(json.truncated === true)
      } else {
        onToast(errorMessage(json, 'Failed to load events.'), false)
      }
    } catch {
      if (seq === requestRef.current) onToast('Failed to load events.', false)
    } finally {
      if (seq === requestRef.current) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter])

  useEffect(() => { load() }, [load])

  const term = search.trim().toLowerCase()
  const visible = term
    ? events.filter(e =>
        [hostLabel(e), e.course?.name ?? '', e.course?.city ?? '']
          .some(v => v.toLowerCase().includes(term))
      )
    : events

  return (
    <>
      <div className="flex gap-1.5 flex-wrap mb-3">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
              filter === f.key ? 'bg-green-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {f.label}
            {/* The queue count is what says "there is work here", and it's read
                unfiltered so it's right in every view. */}
            {f.key === 'pending_credit_approval' && pendingCount > 0 && ` (${pendingCount})`}
          </button>
        ))}
      </div>

      <input
        type="search"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search host or course"
        className="w-full mb-4 px-3 py-2 text-sm rounded-xl border border-gray-200 focus:border-green-700 outline-none transition-colors"
      />

      {truncated && (
        <p className="mb-3 text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2">
          Showing the first {events.length} events in this view. Narrow the filter to see the rest.
        </p>
      )}

      {loading ? (
        <div className="py-16 text-center text-sm text-gray-400">Loading…</div>
      ) : visible.length === 0 ? (
        <AdminCard>
          <p className="text-sm text-gray-400 italic py-6 text-center">
            {events.length === 0 ? 'No events in this view.' : 'No events match that search.'}
          </p>
        </AdminCard>
      ) : (
        <div className="space-y-3">
          {visible.map(e => (
            <EventRow key={e.id} event={e} onChanged={load} onToast={onToast} />
          ))}
        </div>
      )}
    </>
  )
}

const EventRow = memo(function EventRow({ event, onChanged, onToast }: {
  event: HostedEvent
  onChanged: () => void
  onToast: (msg: string, ok?: boolean) => void
}) {
  const [busy, setBusy] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  // What the host gets credited. Starts at the rate they listed the event at,
  // which is what approving used to award with no say in it.
  const [amount, setAmount] = useState(String(event.member_guest_rate))
  const [note, setNote] = useState('')
  const meta = STATUS_META[event.status]
  const proofs = event.proofs ?? []

  // Only ask why when the figure has actually been changed — at the listed rate
  // there's nothing to explain.
  const overridden = Number(amount) !== Number(event.member_guest_rate)

  // Credit decision, once the event has run and proof is in.
  const awaitingCredit = event.status === 'pending_credit_approval'
  // Publish decision. A host's event isn't visible to anyone until this — and
  // approving is the statement that its GHL calendar is set up.
  const awaitingApproval = event.status === 'pending_approval'
  // Listing decision. A bad listing can be pulled before it's published or
  // after; the difference is only whether anyone had a spot to lose.
  const canTakeDown = event.status === 'upcoming' || awaitingApproval

  async function decide(action: 'approve' | 'reject') {
    if (busy) return
    if (action === 'reject' && !reason.trim()) { onToast('Enter a reason.', false); return }
    if (action === 'approve' && !(Number(amount) > 0)) {
      onToast('Enter a credit amount greater than zero.', false)
      return
    }
    setBusy(true)
    const res = await fetch(`/api/admin/hosted-events/${event.id}/credits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action === 'approve'
        ? { action, amount: Number(amount), ...(note.trim() ? { note: note.trim() } : {}) }
        : { action, reason: reason.trim() }),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { onToast(errorMessage(json, 'Action failed.'), false); return }

    onToast(action === 'approve'
      ? `Credit of ${fmtMoney(json.amount ?? event.member_guest_rate)} awarded.`
      : 'Credit rejected.')
    setRejecting(false); setReason(''); setNote('')
    onChanged()
  }

  // Publishes a pending event. Only press this once the event's GHL calendar
  // exists — nothing here can check that, so it's the admin's assertion.
  async function publish() {
    if (busy) return
    setBusy(true)
    const res = await fetch(`/api/admin/hosted-events/${event.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve' }),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { onToast(errorMessage(json, 'Could not publish.'), false); return }
    onToast('Published — members can reserve a spot now.')
    onChanged()
  }

  // Cancels the event and releases anyone who had reserved. There is no
  // draft to park it in, so this is final — the host would have to list it again.
  async function takeDown() {
    if (busy) return
    if (!reason.trim()) { onToast('Enter a reason.', false); return }
    setBusy(true)
    const res = await fetch(`/api/admin/hosted-events/${event.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reject', reason: reason.trim() }),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { onToast(errorMessage(json, 'Action failed.'), false); return }

    const released = Number(json.released ?? 0)
    onToast(released > 0
      ? `Event taken down — ${released} reserved ${released === 1 ? 'member' : 'members'} released.`
      : 'Event taken down.')
    setRejecting(false); setReason('')
    onChanged()
  }

  return (
    <div className="card card-pad">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-gray-900">{event.course?.name ?? 'Course'}</p>
            <Badge label={meta.label} colour={meta.colour} />
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {hostLabel(event)} · {fmtDate(event.event_date)}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            {event.filled_spots ?? 0}/{event.total_spots} spots · credit {fmtMoney(event.member_guest_rate)}
          </p>
        </div>
      </div>

      {/* Proof thumbnails. The image is always the Supabase copy — that one is
          guaranteed to exist. The caption says whether the GHL mirror landed,
          so a silent run of failures is visible instead of only in the logs. */}
      {proofs.length > 0 && (
        <div className="flex gap-2 mt-3 flex-wrap">
          {proofs.map(p => (
            <div key={p.id} className="w-20">
              <a href={p.image_url} target="_blank" rel="noopener noreferrer" className="block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.image_url} alt="Event proof" className="w-20 h-20 object-cover rounded-lg border border-gray-200" />
              </a>
              {p.ghl_media_url ? (
                <a
                  href={p.ghl_media_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block mt-1 text-[10px] font-medium text-green-800 hover:underline"
                >
                  In GHL ↗
                </a>
              ) : (
                <span className="block mt-1 text-[10px] text-gray-400">Not in GHL</span>
              )}
            </div>
          ))}
        </div>
      )}

      {event.source_booking_id && (
        <p className="text-[11px] text-gray-400 mt-2">Listed from one of the host&apos;s existing bookings.</p>
      )}

      {/* rejection_reason on a cancelled event means an admin pulled it, rather
          than the host calling their own event off. */}
      {event.status === 'cancelled' && event.rejection_reason && (
        <p className="text-[11px] text-red-600 mt-2">Taken down: {event.rejection_reason}</p>
      )}

      {awaitingApproval && !rejecting && (
        <div className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-100">
          <p className="text-[11px] text-amber-800">
            Not visible to members yet. Set up this event&apos;s GHL calendar and
            assign the host first — publishing makes it bookable immediately.
          </p>
        </div>
      )}

      {canTakeDown && (
        <div className="mt-4 flex flex-wrap gap-2">
          {awaitingApproval && !rejecting && (
            <button onClick={publish} disabled={busy} className="btn btn-sm bg-green-800 text-white">
              Publish to members
            </button>
          )}
          {!rejecting ? (
            <button onClick={() => setRejecting(true)} disabled={busy} className="btn btn-outline btn-sm text-red-600 border-red-200">
              Take down
            </button>
          ) : (
            <div className="w-full p-3 rounded-xl bg-red-50 border border-red-100 space-y-2">
              <p className="text-[11px] text-red-700">
                {awaitingApproval
                  ? 'Cancels the event before it is published. Nobody has reserved a spot, but the host would have to create it again from scratch.'
                  : 'Cancels the event, takes it off the member list, and releases anyone who reserved. The host would have to list it again from scratch.'}
              </p>
              <input
                className="input text-sm"
                placeholder="Reason (shown to the host)"
                value={reason}
                onChange={e => setReason(e.target.value)}
              />
              <div className="flex gap-2">
                <button onClick={() => { setRejecting(false); setReason('') }} disabled={busy} className="btn btn-outline btn-sm flex-1">Back</button>
                <button onClick={takeDown} disabled={busy} className="btn btn-sm flex-1 bg-red-600 text-white">
                  Take down event
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {awaitingCredit && (
        <div className="mt-4">
          {proofs.length === 0 && (
            <p className="text-[11px] text-amber-600 mb-2">No proof image was uploaded.</p>
          )}
          {!rejecting ? (
            <div className="space-y-2">
              {/* Editable before approving, so a round that ran differently to
                  the listing can be credited for what it was actually worth. */}
              <div className="flex items-end gap-2 flex-wrap">
                <div>
                  <label htmlFor={`credit-${event.id}`} className="block text-[11px] font-medium text-gray-600 mb-1">
                    Credit to award
                  </label>
                  <div className="relative w-32">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
                    <input
                      id={`credit-${event.id}`}
                      type="number"
                      min={0}
                      step="1"
                      className="input text-sm pl-7"
                      value={amount}
                      onChange={e => setAmount(e.target.value)}
                    />
                  </div>
                </div>
                <button onClick={() => decide('approve')} disabled={busy} className="btn btn-sm bg-green-900 text-white">
                  Approve credit
                </button>
                <button onClick={() => setRejecting(true)} disabled={busy} className="btn btn-outline btn-sm text-red-600 border-red-200">
                  Reject
                </button>
              </div>

              {overridden && (
                <div className="space-y-1">
                  <p className="text-[11px] text-amber-600">
                    The host listed this event at {fmtMoney(event.member_guest_rate)}.
                  </p>
                  <input
                    className="input text-sm"
                    placeholder="Why the different amount (optional, saved to the ledger)"
                    value={note}
                    onChange={e => setNote(e.target.value)}
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="p-3 rounded-xl bg-red-50 border border-red-100 space-y-2">
              <input
                className="input text-sm"
                placeholder="Reason (shown to the host)"
                value={reason}
                onChange={e => setReason(e.target.value)}
              />
              <div className="flex gap-2">
                <button onClick={() => { setRejecting(false); setReason('') }} disabled={busy} className="btn btn-outline btn-sm flex-1">Back</button>
                <button onClick={() => decide('reject')} disabled={busy} className="btn btn-sm flex-1 bg-red-600 text-white">
                  Reject credit
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
})
