'use client'

// Admin: browse all hosted events, review proof, and approve or reject the
// host's credit. Rendered as a tab on the admin Hosts page.

import { useState, useEffect, useCallback, memo } from 'react'
import { AdminCard, Badge } from '@/components/admin/AdminUI'
import type { HostedEvent, HostedEventStatus } from '@/types'

const fmtMoney = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 })

const fmtDate = (d: string) =>
  new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

const STATUS_META: Record<HostedEventStatus, { label: string; colour: 'green' | 'gold' | 'red' | 'blue' | 'gray' }> = {
  draft:                   { label: 'Draft',            colour: 'gray' },
  pending_review:          { label: 'Awaiting review',  colour: 'gold' },
  upcoming:                { label: 'Upcoming',         colour: 'green' },
  completed:               { label: 'Completed',        colour: 'blue' },
  pending_credit_approval: { label: 'Credit approval',  colour: 'gold' },
  credits_awarded:         { label: 'Credits awarded',  colour: 'green' },
  cancelled:               { label: 'Cancelled',        colour: 'red' },
}

const FILTERS: { key: string; label: string }[] = [
  { key: 'pending_review', label: 'Awaiting review' },
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
  const [filter, setFilter] = useState('pending_review')

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

  // Two distinct decisions land on this row: approving the event so members can
  // see it, and (after it runs) approving the host's credit.
  const awaitingReview = event.status === 'pending_review'
  const awaitingCredit = event.status === 'pending_credit_approval'
  const endpoint = awaitingReview ? 'review' : 'credits'

  async function decide(action: 'approve' | 'reject') {
    if (busy) return
    if (action === 'reject' && !reason.trim()) { onToast('Enter a reason.', false); return }
    setBusy(true)
    const res = await fetch(`/api/admin/hosted-events/${event.id}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action === 'approve' ? { action } : { action, reason: reason.trim() }),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { onToast(json.error ?? 'Action failed.', false); return }

    if (awaitingReview) {
      onToast(action === 'approve' ? 'Event approved — now live for members.' : 'Event sent back to the host.')
    } else {
      onToast(action === 'approve'
        ? `Credit of ${fmtMoney(json.amount ?? event.member_guest_rate)} awarded.`
        : 'Credit rejected.')
    }
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

      {(awaitingReview || awaitingCredit) && (
        <div className="mt-4">
          {awaitingCredit && proofs.length === 0 && (
            <p className="text-[11px] text-amber-600 mb-2">No proof image was uploaded.</p>
          )}
          {!rejecting ? (
            <div className="flex gap-2">
              <button onClick={() => decide('approve')} disabled={busy} className="btn btn-sm bg-green-900 text-white">
                {awaitingReview ? 'Approve event' : 'Approve credit'}
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
                  {awaitingReview ? 'Send back' : 'Reject credit'}
                </button>
              </div>
            </div>
          )}
          {awaitingReview && (
            <p className="text-[11px] text-gray-400 mt-2">
              Approving makes this event visible to members. Rejecting returns it to the host as a draft.
            </p>
          )}
        </div>
      )}
    </div>
  )
})
