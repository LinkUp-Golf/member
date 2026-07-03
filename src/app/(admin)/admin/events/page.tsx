'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { COURSE_SLUGS } from '@/lib/ghl/tags'
import {
  AdminPageHeader, AdminButton, Badge, StatCard,
} from '@/components/admin/AdminUI'
import { format } from 'date-fns'
import { formatRelativeTime } from '@/lib/utils'

type EventStatus = 'pending_review' | 'published' | 'rejected'
type FilterTab = 'pending_review' | 'published' | 'rejected'

interface EventRow {
  id: string
  title: string
  description: string
  event_date: string
  event_end_date: string | null
  event_time: string | null
  location: string
  external_url: string | null
  status: EventStatus
  rejection_reason: string | null
  created_at: string
  organizer_id: string
  organizer: {
    id: string
    first_name: string
    last_name: string
    email: string
    membership_status: string
  } | null
}

const STATUS_META: Record<EventStatus, { label: string; colour: 'green' | 'yellow' | 'red' }> = {
  pending_review: { label: 'Pending review', colour: 'yellow' },
  published:      { label: 'Published',      colour: 'green' },
  rejected:       { label: 'Rejected',       colour: 'red' },
}

const FILTER_LABELS: Record<FilterTab, string> = {
  pending_review: 'Pending',
  published:      'Published',
  rejected:       'Rejected',
}

export default function AdminEventsPage() {
  const [events, setEvents] = useState<EventRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterTab>('pending_review')
  const [processing, setProcessing] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  const loadEvents = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()

    const { data: courses } = await supabase
      .from('courses')
      .select('id')
      .in('slug', COURSE_SLUGS)
    const courseIds = (courses ?? []).map(c => c.id)
    if (!courseIds.length) { setLoading(false); return }

    const { data, error } = await supabase
      .from('member_events')
      .select(`
        id, title, description, event_date, event_end_date, event_time, location,
        external_url, status, rejection_reason, created_at, organizer_id,
        organizer:members!organizer_id(id, first_name, last_name, email, membership_status)
      `)
      .in('course_id', courseIds)
      .order('event_date', { ascending: true })

    if (error) console.error('[admin/events]', error.message)
    setEvents((data ?? []) as unknown as EventRow[])
    setLoading(false)
  }, [])

  useEffect(() => { loadEvents() }, [loadEvents])

  async function patchEvent(event: EventRow, body: Record<string, unknown>, toastMsg: string): Promise<boolean> {
    setProcessing(event.id)
    const res = await fetch(`/api/admin/events/${event.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      showToast(toastMsg)
    } else {
      const json = await res.json().catch(() => ({}))
      showToast(json.error ?? 'Action failed.', false)
    }
    await loadEvents()
    setProcessing(null)
    return res.ok
  }

  const approve = (event: EventRow) =>
    patchEvent(event, { status: 'published' }, '✓ Event approved and published.')

  async function rejectEvent(event: EventRow) {
    if (!rejectReason.trim()) { showToast('Please enter a rejection reason.', false); return }
    const ok = await patchEvent(event, { status: 'rejected', rejection_reason: rejectReason.trim() }, 'Event rejected.')
    if (ok) { setRejectingId(null); setRejectReason('') }
  }

  const revert = (event: EventRow) =>
    patchEvent(event, { status: 'pending_review' }, 'Event moved back to pending review.')

  async function saveEdit(event: EventRow, payload: Record<string, unknown>) {
    const ok = await patchEvent(event, payload, 'Event updated.')
    if (ok) setEditingId(null)
  }

  async function deleteEvent(event: EventRow) {
    setProcessing(event.id)
    const res = await fetch(`/api/admin/events/${event.id}`, { method: 'DELETE' })
    if (res.ok) {
      showToast('Event deleted.')
      setDeletingId(null)
    } else {
      const json = await res.json().catch(() => ({}))
      showToast(json.error ?? 'Delete failed.', false)
    }
    await loadEvents()
    setProcessing(null)
  }

  const pending   = events.filter(e => e.status === 'pending_review')
  const published = events.filter(e => e.status === 'published')
  const rejected  = events.filter(e => e.status === 'rejected')

  const countMap: Record<FilterTab, number> = {
    pending_review: pending.length,
    published:      published.length,
    rejected:       rejected.length,
  }

  const filtered = events.filter(e => e.status === filter)

  return (
    <div className="p-4 sm:p-8">
      <AdminPageHeader
        title="Member Events"
        description="Review and approve community-submitted events"
      />

      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${
          toast.ok ? 'bg-green-900 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* Stats */}
      {!loading && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <StatCard label="Pending review" value={pending.length}   sub="Awaiting decision" colour="blue" />
          <StatCard label="Published"      value={published.length} sub="Live events"       colour="green" />
          <StatCard label="Rejected"       value={rejected.length}  sub="Declined"          colour="gray" />
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1.5 mb-5">
        {(Object.keys(FILTER_LABELS) as FilterTab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filter === tab
                ? 'bg-green-900 text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {FILTER_LABELS[tab]}
            {countMap[tab] > 0 && (
              <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
                filter === tab ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'
              }`}>
                {countMap[tab]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Event list */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-40 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-4xl mb-3">📅</p>
          <p className="text-lg font-semibold text-gray-700 mb-1">
            No {FILTER_LABELS[filter].toLowerCase()} events
          </p>
          <p className="text-sm text-gray-400">
            {filter === 'pending_review' ? 'Nothing awaiting review right now.' : 'None yet.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map(event => {
            const sm = STATUS_META[event.status]
            const organizerName = event.organizer
              ? `${event.organizer.first_name} ${event.organizer.last_name}`
              : 'Unknown'
            const isProcessing = processing === event.id
            const isRejecting = rejectingId === event.id
            const isEditing = editingId === event.id
            const startDate  = new Date(event.event_date + 'T12:00:00')
            const endDate    = event.event_end_date ? new Date(event.event_end_date + 'T12:00:00') : null
            const isMultiDay = !!endDate && event.event_end_date !== event.event_date

            return (
              <div key={event.id} className="bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm flex">
                {/* Date column */}
                <div
                  className="flex flex-col items-center justify-center px-3 py-4 flex-shrink-0 w-16 text-center"
                  style={{ background: event.status === 'pending_review' ? '#1e3a5f' : event.status === 'published' ? 'var(--color-green-900, #14532d)' : '#6b7280' }}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-white/60">
                    {format(startDate, 'MMM')}
                  </p>
                  <p className="text-2xl font-black text-white leading-none mt-0.5">
                    {format(startDate, 'd')}
                  </p>
                  {isMultiDay ? (
                    <p className="text-[10px] text-white/60 mt-1 leading-tight">
                      – {format(endDate, 'MMM d')}
                    </p>
                  ) : event.event_time ? (
                    <p className="text-[10px] text-white/60 mt-1.5">{event.event_time.slice(0, 5)}</p>
                  ) : null}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 p-4">
                  <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-gray-900 text-sm">{event.title}</h3>
                      <Badge label={sm.label} colour={sm.colour} />
                    </div>
                    <span className="text-[11px] text-gray-400 flex-shrink-0">
                      {formatRelativeTime(event.created_at)}
                    </span>
                  </div>

                  {isEditing ? (
                    <AdminEventEditForm
                      event={event}
                      saving={isProcessing}
                      onSave={payload => saveEdit(event, payload)}
                      onCancel={() => setEditingId(null)}
                    />
                  ) : (
                    <>
                      <p className="text-[11px] text-gray-400 mb-1.5">📍 {event.location}</p>
                      <p className="text-xs text-gray-500 leading-relaxed line-clamp-2 mb-3">{event.description}</p>

                      {event.external_url && (
                        <a
                          href={event.external_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-green-700 hover:underline block mb-3"
                        >
                          {event.external_url} ↗
                        </a>
                      )}

                      {event.rejection_reason && (
                        <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-3 whitespace-pre-wrap">Reason: {event.rejection_reason}</p>
                      )}

                      {isRejecting && (
                        <div className="mb-3">
                          <textarea
                            rows={3}
                            placeholder="Rejection reason (required)"
                            value={rejectReason}
                            onChange={e => setRejectReason(e.target.value)}
                            className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 outline-none focus:border-red-300 resize-none mb-2"
                          />
                          <div className="flex gap-2">
                            <button onClick={() => rejectEvent(event)} disabled={isProcessing || !rejectReason.trim()} className="px-3 py-2 rounded-lg bg-red-600 text-white text-xs font-medium disabled:opacity-50">
                              {isProcessing ? '…' : 'Confirm'}
                            </button>
                            <button onClick={() => { setRejectingId(null); setRejectReason('') }} className="px-3 py-2 rounded-lg border border-gray-200 text-xs text-gray-600">Cancel</button>
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  <div className="flex items-center justify-between gap-3 pt-3 border-t border-gray-50 flex-wrap">
                    <div>
                      <p className="text-xs font-medium text-gray-700">{organizerName}</p>
                      <p className="text-[11px] text-gray-400">{event.organizer?.email}</p>
                    </div>
                    {!isEditing && (
                      <div className="flex gap-1.5">
                        {event.status === 'pending_review' && !isRejecting && (
                          <>
                            <AdminButton label={isProcessing ? 'Saving…' : 'Approve'} onClick={() => approve(event)} variant="primary" size="sm" disabled={isProcessing} />
                            <AdminButton label="Reject" onClick={() => { setRejectingId(event.id); setRejectReason('') }} variant="danger" size="sm" disabled={isProcessing} />
                          </>
                        )}
                        {event.status === 'published' && (
                          <AdminButton label={isProcessing ? '…' : 'Unpublish'} onClick={() => revert(event)} variant="ghost" size="sm" disabled={isProcessing} />
                        )}
                        {event.status === 'rejected' && (
                          <AdminButton label={isProcessing ? '…' : 'Reconsider'} onClick={() => revert(event)} variant="ghost" size="sm" disabled={isProcessing} />
                        )}
                        {!isRejecting && (
                          <>
                            <AdminButton label="Edit" onClick={() => setEditingId(event.id)} variant="ghost" size="sm" disabled={isProcessing} />
                            <AdminButton label="Delete" onClick={() => setDeletingId(event.id)} variant="danger" size="sm" disabled={isProcessing} />
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {deletingId && (
        <DeleteEventModal
          event={events.find(e => e.id === deletingId) ?? null}
          processing={!!processing}
          onConfirm={() => {
            const event = events.find(e => e.id === deletingId)
            if (event) deleteEvent(event)
          }}
          onClose={() => setDeletingId(null)}
        />
      )}
    </div>
  )
}

// ---- Inline admin edit form ----------------------------------

function AdminEventEditForm({
  event,
  saving,
  onSave,
  onCancel,
}: {
  event: EventRow
  saving: boolean
  onSave: (payload: Record<string, unknown>) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState(event.title)
  const [description, setDescription] = useState(event.description)
  const [date, setDate] = useState(event.event_date)
  const [endDate, setEndDate] = useState(event.event_end_date ?? '')
  const [time, setTime] = useState((event.event_time ?? '').slice(0, 5))
  const [location, setLocation] = useState(event.location)
  const [url, setUrl] = useState(event.external_url ?? '')

  const inputCls = 'w-full px-3 py-2 text-sm border rounded-lg outline-none transition-colors border-gray-200 focus:border-green-500'
  const canSave = !!title.trim() && !!description.trim() && !!date && !!time && !!location.trim()

  function handleSave() {
    if (!canSave) return
    onSave({
      title: title.trim(),
      description: description.trim(),
      event_date: date,
      event_end_date: endDate && endDate > date ? endDate : null,
      event_time: time.length === 5 ? `${time}:00` : time,
      location: location.trim(),
      external_url: url.trim() || null,
    })
  }

  return (
    <div className="space-y-2 mb-3">
      <input className={inputCls} placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} />
      <textarea className={`${inputCls} resize-none`} rows={2} placeholder="Description" value={description} onChange={e => setDescription(e.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        <input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} />
        <input type="time" className={inputCls} value={time} onChange={e => setTime(e.target.value)} />
      </div>
      <input type="date" className={inputCls} min={date} value={endDate} onChange={e => setEndDate(e.target.value)} placeholder="End date (optional)" />
      <input className={inputCls} placeholder="Location" value={location} onChange={e => setLocation(e.target.value)} />
      <input type="url" className={inputCls} placeholder="Link (optional)" value={url} onChange={e => setUrl(e.target.value)} />
      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={saving || !canSave}
          className="px-3 py-2 rounded-lg text-xs font-semibold bg-green-900 text-white disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button onClick={onCancel} className="px-3 py-2 rounded-lg text-xs font-medium text-gray-600 border border-gray-200">
          Cancel
        </button>
      </div>
    </div>
  )
}

// ---- Delete confirmation modal --------------------------------

function DeleteEventModal({
  event,
  processing,
  onConfirm,
  onClose,
}: {
  event: EventRow | null
  processing: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  if (!event) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mb-4 mx-auto">
          <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>

        <h2 className="text-lg font-bold text-gray-900 text-center mb-2">Delete Event</h2>
        <p className="text-sm text-gray-500 text-center mb-1">
          You&apos;re about to permanently delete
        </p>
        <p className="text-sm font-semibold text-gray-800 text-center mb-4">
          &ldquo;{event.title}&rdquo;
        </p>

        <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 mb-6">
          <p className="text-xs text-amber-700">This also removes all RSVPs for this event. This action cannot be undone.</p>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={processing}
            className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {processing ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}
