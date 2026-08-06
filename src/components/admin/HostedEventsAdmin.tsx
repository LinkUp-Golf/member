'use client'

// Admin: browse all hosted events, review proof, and approve or reject the
// host's credit. Rendered as a tab on the admin Hosts page.
//
// Two decisions live here, one per stage of an event's life:
//   upcoming                → take down a live event that shouldn't be listed
//                             (hosts publish without waiting for approval)
//   pending_credit_approval → approve or reject the host's credit after it ran

import { useState, useEffect, useCallback, memo } from 'react'
import { AdminCard, Badge } from '@/components/admin/AdminUI'
import type { HostedEvent, HostedEventStatus } from '@/types'

const fmtMoney = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 })

const fmtDate = (d: string) =>
  new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

const STATUS_META: Record<HostedEventStatus, { label: string; colour: 'green' | 'gold' | 'red' | 'blue' | 'gray' }> = {
  upcoming:                { label: 'Upcoming',         colour: 'green' },
  completed:               { label: 'Completed',        colour: 'blue' },
  pending_credit_approval: { label: 'Credit approval',  colour: 'gold' },
  credits_awarded:         { label: 'Credits awarded',  colour: 'green' },
  cancelled:               { label: 'Cancelled',        colour: 'red' },
}

const FILTERS: { key: string; label: string }[] = [
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

  const load = useCallback(async () => {
    setLoading(true)
    const qs = filter ? `?status=${filter}` : ''
    const res = await fetch(`/api/admin/hosted-events${qs}`)
    const json = await res.json().catch(() => ({}))
    if (res.ok) setEvents(Array.isArray(json.events) ? json.events : [])
    else onToast(json.error ?? 'Failed to load events.', false)
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter])

  useEffect(() => { load() }, [load])

  return (
    <>
      <div className="flex gap-1.5 flex-wrap mb-4">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
              filter === f.key ? 'bg-green-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-gray-400">Loading…</div>
      ) : events.length === 0 ? (
        <AdminCard><p className="text-sm text-gray-400 italic py-6 text-center">No events in this view.</p></AdminCard>
      ) : (
        <div className="space-y-3">
          {events.map(e => (
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
  const meta = STATUS_META[event.status]
  const proofs = event.proofs ?? []

  // Credit decision, once the event has run and proof is in.
  const awaitingCredit = event.status === 'pending_credit_approval'
  // Listing decision, while the event is live. Hosts publish without waiting
  // for approval, so this is where an admin takes a bad listing back down.
  const canTakeDown = event.status === 'upcoming'

  async function decide(action: 'approve' | 'reject') {
    if (busy) return
    if (action === 'reject' && !reason.trim()) { onToast('Enter a reason.', false); return }
    setBusy(true)
    const res = await fetch(`/api/admin/hosted-events/${event.id}/credits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action === 'approve' ? { action } : { action, reason: reason.trim() }),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { onToast(json.error ?? 'Action failed.', false); return }

    onToast(action === 'approve'
      ? `Credit of ${fmtMoney(json.amount ?? event.member_guest_rate)} awarded.`
      : 'Credit rejected.')
    setRejecting(false); setReason('')
    onChanged()
  }

  // Cancels a live event and releases anyone who had reserved. There is no
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
    if (!res.ok) { onToast(json.error ?? 'Action failed.', false); return }

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

      {/* Proof thumbnails */}
      {proofs.length > 0 && (
        <div className="flex gap-2 mt-3 flex-wrap">
          {proofs.map(p => (
            <a key={p.id} href={p.image_url} target="_blank" rel="noopener noreferrer" className="block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.image_url} alt="Event proof" className="w-20 h-20 object-cover rounded-lg border border-gray-200" />
            </a>
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

      {canTakeDown && (
        <div className="mt-4">
          {!rejecting ? (
            <button onClick={() => setRejecting(true)} disabled={busy} className="btn btn-outline btn-sm text-red-600 border-red-200">
              Take down
            </button>
          ) : (
            <div className="p-3 rounded-xl bg-red-50 border border-red-100 space-y-2">
              <p className="text-[11px] text-red-700">
                Cancels the event, takes it off the member list, and releases anyone
                who reserved. The host would have to list it again from scratch.
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
            <div className="flex gap-2">
              <button onClick={() => decide('approve')} disabled={busy} className="btn btn-sm bg-green-900 text-white">
                Approve credit
              </button>
              <button onClick={() => setRejecting(true)} disabled={busy} className="btn btn-outline btn-sm text-red-600 border-red-200">
                Reject
              </button>
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
