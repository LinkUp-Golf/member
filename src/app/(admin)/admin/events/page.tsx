'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { COURSE_SLUGS } from '@/lib/ghl/tags'
import {
  AdminPageHeader, AdminCard, AdminButton, Badge, StatCard,
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
        external_url, status, created_at, organizer_id,
        organizer:members!organizer_id(id, first_name, last_name, email, membership_status)
      `)
      .in('course_id', courseIds)
      .order('event_date', { ascending: true })

    if (error) console.error('[admin/events]', error.message)
    setEvents((data ?? []) as unknown as EventRow[])
    setLoading(false)
  }, [])

  useEffect(() => { loadEvents() }, [loadEvents])

  async function patchEvent(event: EventRow, status: string, toastMsg: string) {
    setProcessing(event.id)
    const res = await fetch(`/api/admin/events/${event.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (res.ok) {
      showToast(toastMsg)
    } else {
      const json = await res.json().catch(() => ({}))
      showToast(json.error ?? 'Action failed.', false)
    }
    await loadEvents()
    setProcessing(null)
  }

  const decide = (event: EventRow, decision: 'published' | 'rejected') =>
    patchEvent(
      event,
      decision,
      decision === 'published' ? '✓ Event approved and published.' : 'Event rejected.'
    )

  const revert = (event: EventRow) =>
    patchEvent(event, 'pending_review', 'Event moved back to pending review.')

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

                  <div className="flex items-center justify-between gap-3 pt-3 border-t border-gray-50 flex-wrap">
                    <div>
                      <p className="text-xs font-medium text-gray-700">{organizerName}</p>
                      <p className="text-[11px] text-gray-400">{event.organizer?.email}</p>
                    </div>
                    <div className="flex gap-1.5">
                      {event.status === 'pending_review' && (
                        <>
                          <AdminButton label={isProcessing ? 'Saving…' : 'Approve'} onClick={() => decide(event, 'published')} variant="primary" size="sm" disabled={isProcessing} />
                          <AdminButton label="Reject" onClick={() => decide(event, 'rejected')} variant="danger" size="sm" disabled={isProcessing} />
                        </>
                      )}
                      {event.status === 'published' && (
                        <AdminButton label={isProcessing ? '…' : 'Unpublish'} onClick={() => revert(event)} variant="ghost" size="sm" disabled={isProcessing} />
                      )}
                      {event.status === 'rejected' && (
                        <AdminButton label={isProcessing ? '…' : 'Reconsider'} onClick={() => revert(event)} variant="ghost" size="sm" disabled={isProcessing} />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
