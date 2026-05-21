'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/auth'
import { apiClient } from '@/lib/api-client'
import { Spinner, CardSkeleton } from '@/components/ui/Loading'
import AppShell from '@/components/layout/AppShell'
import { format } from 'date-fns'
import type { MemberEvent } from '@/types'

type Tab = 'upcoming' | 'submit'

export default function MemberEventsPage() {
  const { user } = useAuthStore()
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('upcoming')
  const [events, setEvents] = useState<MemberEvent[]>([])
  const [rsvps, setRsvps] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (user) loadEvents()
  }, [user])

  async function loadEvents() {
    const response = await apiClient.get<{ events: MemberEvent[]; rsvps: Array<{ event_id: string; status: string }> }>('/api/events')
    if (response.data) {
      setEvents(response.data.events)
      const rsvpMap: Record<string, string> = {}
      response.data.rsvps.forEach(r => { rsvpMap[r.event_id] = r.status })
      setRsvps(rsvpMap)
    }
    setLoading(false)
  }

  async function rsvp(eventId: string, status: 'attending' | 'maybe' | 'declined') {
    if (!user) return
    await apiClient.post(`/api/events/${eventId}/rsvp`, { status })
    setRsvps(prev => ({ ...prev, [eventId]: status }))
  }

  return (
    <AppShell
      header={
        <div className="top-bar flex items-center justify-between">
          <div>
            <div className="logo-text">Member Events</div>
            <div className="logo-subtitle">Community calendar</div>
          </div>
          <button onClick={() => router.push('/more')} className="text-gold">
            <BackArrow />
          </button>
        </div>
      }
    >
      {/* Tabs */}
      <div className="flex border-b border-green-900/08 bg-white">
        {(['upcoming', 'submit'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-3 text-sm font-medium transition-colors border-b-2 ${
              tab === t ? 'border-green-900 text-green-900' : 'border-transparent text-green-900/40'
            }`}
          >
            {t === 'upcoming' ? 'Upcoming events' : 'Submit an event'}
          </button>
        ))}
      </div>

      {tab === 'upcoming' ? (
        <div className="px-5 py-4 pb-8">
          {loading ? (
            <div className="space-y-3">{[1,2,3].map(i => <CardSkeleton key={i} lines={3} />)}</div>
          ) : events.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-3xl mb-3">📅</p>
              <p className="font-serif text-xl text-green-900 mb-2">No events yet</p>
              <p className="text-sm text-green-900/45 mb-5">
                Be the first to post a community event.
              </p>
              <button onClick={() => setTab('submit')} className="btn btn-primary">
                Submit an event
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {events.map(event => (
                <EventCard
                  key={event.id}
                  event={event}
                  rsvpStatus={rsvps[event.id]}
                  onRSVP={status => rsvp(event.id, status)}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <SubmitEventForm
          onSubmitted={() => { setTab('upcoming'); loadEvents() }}
        />
      )}
    </AppShell>
  )
}

// ---- Event card ---------------------------------------------

function EventCard({
  event: e,
  rsvpStatus,
  onRSVP,
}: {
  event: MemberEvent
  rsvpStatus?: string
  onRSVP: (status: 'attending' | 'maybe' | 'declined') => void
}) {
  return (
    <div className="card">
      {/* Date bar */}
      <div className="bg-green-900 px-4 py-2.5 flex items-center justify-between">
        <p className="text-sm font-medium text-white">
          {format(new Date(e.event_date + 'T12:00:00'), 'EEEE, MMMM d')}
        </p>
        <p className="text-xs text-white/50">{e.event_time.slice(0, 5)}</p>
      </div>

      <div className="card-pad">
        <p className="font-serif text-lg text-green-900 font-medium">{e.title}</p>
        <p className="text-xs text-green-900/50 mt-1">📍 {e.location}</p>
        <p className="text-sm text-green-900/70 mt-2 leading-relaxed">{e.description}</p>

        {e.external_url && (
          <a
            href={e.external_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-green-600 mt-2 inline-block"
          >
            More info →
          </a>
        )}

        {/* RSVP buttons */}
        <div className="flex gap-2 mt-4">
          {(['attending', 'maybe', 'declined'] as const).map(status => (
            <button
              key={status}
              onClick={() => onRSVP(status)}
              className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors border ${
                rsvpStatus === status
                  ? status === 'attending' ? 'bg-green-800 text-white border-green-800'
                    : status === 'maybe' ? 'bg-yellow-500 text-white border-yellow-500'
                    : 'bg-red-400 text-white border-red-400'
                  : 'bg-transparent border-green-900/15 text-green-900/50'
              }`}
            >
              {status === 'attending' ? '✓ Attending' : status === 'maybe' ? '? Maybe' : '✕ Can\'t go'}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ---- Submit event form --------------------------------------

function SubmitEventForm({
  onSubmitted,
}: {
  onSubmitted: () => void
}) {
  const today = new Date().toISOString().split('T')[0]
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [location, setLocation] = useState('')
  const [url, setUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  async function handleSubmit() {
    if (!title || !description || !date || !time || !location) return
    setSubmitting(true)
    await apiClient.post('/api/events', {
      title,
      description,
      event_date: date,
      event_time: time + ':00',
      location,
      external_url: url.trim() || null,
    })
    setSubmitting(false)
    setSubmitted(true)
  }

  if (submitted) {
    return (
      <div className="px-5 py-16 text-center">
        <p className="text-4xl mb-4">✅</p>
        <p className="font-serif text-xl text-green-900 mb-2">Event submitted</p>
        <p className="text-sm text-green-900/55 mb-6 leading-relaxed">
          Your event is pending review. Once approved, it will appear on the community calendar.
        </p>
        <button onClick={onSubmitted} className="btn btn-primary">
          Back to events
        </button>
      </div>
    )
  }

  return (
    <div className="px-5 py-5 pb-8 space-y-4">
      <div className="card card-pad space-y-1">
        <p className="text-xs text-green-900/45 leading-relaxed">
          Events are reviewed before posting. Please only submit events relevant to the business community.
        </p>
      </div>

      <Field label="Event title">
        <input className="input" placeholder="Annual client reception…" value={title} onChange={e => setTitle(e.target.value)} />
      </Field>

      <Field label="Description">
        <textarea className="input resize-none" rows={3} placeholder="What is this event? Who should attend?" value={description} onChange={e => setDescription(e.target.value)} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Date">
          <input type="date" className="input" min={today} value={date} onChange={e => setDate(e.target.value)} />
        </Field>
        <Field label="Time">
          <input type="time" className="input" value={time} onChange={e => setTime(e.target.value)} />
        </Field>
      </div>

      <Field label="Location">
        <input className="input" placeholder="Venue name and address" value={location} onChange={e => setLocation(e.target.value)} />
      </Field>

      <Field label="Website or registration link (optional)">
        <input type="url" className="input" placeholder="https://…" value={url} onChange={e => setUrl(e.target.value)} />
      </Field>

      <button
        onClick={handleSubmit}
        disabled={!title || !description || !date || !time || !location || submitting}
        className="btn btn-gold btn-full mt-2"
      >
        {submitting ? <Spinner className="w-4 h-4 text-green-900" /> : 'Submit for review'}
      </button>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-green-900/50 mb-1.5 block">{label}</label>
      {children}
    </div>
  )
}

function BackArrow() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
    </svg>
  )
}
