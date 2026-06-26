'use client'

import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import Image from 'next/image'
import { useProfile } from '@/hooks/useProfile'
import { apiClient } from '@/lib/api-client'
import { Spinner, CardSkeleton } from '@/components/ui/Loading'
import AppShell from '@/components/layout/AppShell'
import MemberProfileSheet from '@/components/ui/MemberProfileSheet'
import { format } from 'date-fns'
import type { MemberEvent } from '@/types'

type Attendee = { member_id: string; first_name: string; last_name: string; avatar_url: string | null }

type Tab = 'browse' | 'submit'

export default function MemberEventsPage() {
  const { user } = useProfile()
  const [tab, setTab] = useState<Tab>('browse')
  const [events, setEvents] = useState<MemberEvent[]>([])
  const [rsvps, setRsvps] = useState<Record<string, string>>({})
  const [attendees, setAttendees] = useState<Record<string, Attendee[]>>({})
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [profileMemberId, setProfileMemberId] = useState<string | null>(null)
  const [submitBanner, setSubmitBanner] = useState(false)

  useEffect(() => {
    if (user) loadEvents()
  }, [user])

  async function loadEvents() {
    const response = await apiClient.get<{
      events: MemberEvent[]
      rsvps: Array<{ event_id: string; status: string }>
      attendees: Record<string, Attendee[]>
    }>('/api/events')
    if (response.data) {
      setEvents(response.data.events)
      const rsvpMap: Record<string, string> = {}
      response.data.rsvps.forEach(r => { rsvpMap[r.event_id] = r.status })
      setRsvps(rsvpMap)
      setAttendees(response.data.attendees ?? {})
    }
    setLoading(false)
  }

  async function rsvp(eventId: string, status: 'attending' | 'maybe' | 'declined') {
    if (!user) return
    await apiClient.post(`/api/events/${eventId}/rsvp`, { status })
    setRsvps(prev => ({ ...prev, [eventId]: status }))
  }

  async function deleteEvent(eventId: string) {
    setDeletingId(eventId)
    await apiClient.delete(`/api/events/${eventId}`)
    setEvents(prev => prev.filter(e => e.id !== eventId))
    setDeletingId(null)
  }

  async function updateEvent(eventId: string, payload: Partial<MemberEvent>) {
    const res = await apiClient.patch<MemberEvent>(`/api/events/${eventId}`, payload)
    if (res.data) {
      setEvents(prev => prev.map(e => e.id === eventId ? { ...e, ...res.data } : e))
      setEditingId(null)
    }
  }

  return (
    <>
    <MemberProfileSheet memberId={profileMemberId} onClose={() => setProfileMemberId(null)} />
    <AppShell
      header={
        <div className="top-bar flex items-center justify-between">
          <div>
            <div className="font-sans font-black text-2xl" style={{ color: 'var(--color-gold)' }}>Member Events</div>
            <div className="logo-subtitle">Community calendar</div>
          </div>
        </div>
      }
    >
      {/* Tabs */}
      <div className="flex border-b border-green-900/08 bg-white">
        {(['browse', 'submit'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-3 text-sm font-medium transition-colors border-b-2 ${
              tab === t ? 'border-green-900 text-green-900' : 'border-transparent text-green-900/40'
            }`}
          >
            {t === 'browse' ? 'Community Events' : 'Submit an event'}
          </button>
        ))}
      </div>

      {tab === 'browse' ? (
        <div className="px-5 py-4 pb-8">
          {submitBanner && (
            <div className="mb-4 rounded-2xl px-4 py-3 flex items-center gap-3" style={{ background: 'rgba(133,187,101,0.1)', border: '1px solid rgba(133,187,101,0.25)' }}>
              <span className="text-lg">✅</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold" style={{ color: 'var(--color-green-900)' }}>Event submitted</p>
                <p className="text-xs mt-0.5" style={{ color: 'rgba(0,38,105,0.5)' }}>Pending review — once approved it will appear on the community calendar.</p>
              </div>
              <button type="button" onClick={() => setSubmitBanner(false)} className="text-xs" style={{ color: 'rgba(0,38,105,0.3)' }}>✕</button>
            </div>
          )}
          {loading ? (
            <div className="space-y-3">{[1,2,3].map(i => <CardSkeleton key={i} lines={3} />)}</div>
          ) : events.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-3xl mb-3">📅</p>
              <p className="font-sans font-black text-xl text-green-900 mb-2">No events yet</p>
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
                  userId={user?.id}
                  rsvpStatus={rsvps[event.id]}
                  attendees={attendees[event.id] ?? []}
                  isEditing={editingId === event.id}
                  isDeleting={deletingId === event.id}
                  onRSVP={status => rsvp(event.id, status)}
                  onEdit={() => setEditingId(event.id)}
                  onCancelEdit={() => setEditingId(null)}
                  onSaveEdit={payload => updateEvent(event.id, payload)}
                  onDelete={() => deleteEvent(event.id)}
                  onSelectAttendee={setProfileMemberId}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <SubmitEventForm
          onSubmitted={(newEvent) => {
            setEvents(prev => [newEvent, ...prev])
            setTab('browse')
            setSubmitBanner(true)
            setTimeout(() => setSubmitBanner(false), 5000)
          }}
        />
      )}
    </AppShell>
    </>
  )
}

// ---- Event card ---------------------------------------------

function EventCard({
  event: e,
  userId,
  rsvpStatus,
  attendees,
  isEditing,
  isDeleting,
  onRSVP,
  onEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onSelectAttendee,
}: {
  event: MemberEvent
  userId?: string
  rsvpStatus?: string
  attendees: Attendee[]
  isEditing: boolean
  isDeleting: boolean
  onRSVP: (status: 'attending' | 'maybe' | 'declined') => void
  onEdit: () => void
  onCancelEdit: () => void
  onSaveEdit: (payload: Partial<MemberEvent>) => void
  onDelete: () => void
  onSelectAttendee: (memberId: string) => void
}) {
  const isPending   = e.status === 'pending_review'
  const isOrganizer = !!userId && e.organizer_id === userId
  const startDate  = new Date(e.event_date + 'T12:00:00')
  const endDate    = e.event_end_date ? new Date(e.event_end_date + 'T12:00:00') : null
  const isMultiDay = !!endDate && e.event_end_date !== e.event_date
  const sameMonth  = isMultiDay && !!endDate &&
    format(startDate, 'yyyyMM') === format(endDate, 'yyyyMM')

  // Build date header label
  const dateLabel = isMultiDay
    ? sameMonth
      ? `${format(startDate, 'MMM d')} – ${format(endDate!, 'd')}`
      : `${format(startDate, 'MMM d')} – ${format(endDate!, 'MMM d')}`
    : format(startDate, 'EEE, MMM d')

  return (
    <div className="card overflow-hidden" style={isPending ? { opacity: 0.8 } : undefined}>
      {/* Date header */}
      <div
        className="px-4 py-2.5 flex items-center justify-between"
        style={{ background: isPending ? 'rgba(0,38,105,0.45)' : 'var(--color-green-900)' }}
      >
        <p className="text-sm font-medium text-white">{dateLabel}</p>
        <div className="flex items-center gap-2">
          {isPending && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-white/15 text-white/80">
              Pending
            </span>
          )}
          <p className="text-xs text-white/50">{e.event_time.slice(0, 5)}</p>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-1">
          <p className="font-sans font-black text-sm text-green-900 leading-snug">{e.title}</p>
          <div className="flex items-center gap-1 flex-shrink-0">
            {isOrganizer && !isEditing && (
              <>
                <button
                  onClick={onEdit}
                  className="text-[10px] px-1.5 py-0.5 rounded-md text-green-900/40 hover:text-green-900/70 hover:bg-green-900/06 transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={onDelete}
                  disabled={isDeleting}
                  className="text-[10px] px-1.5 py-0.5 rounded-md text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40"
                >
                  {isDeleting ? '…' : 'Delete'}
                </button>
              </>
            )}
          </div>
        </div>
        <p className="text-[11px] text-green-900/45 mb-2">📍 {e.location}</p>
        <p className="text-xs text-green-900/60 leading-relaxed line-clamp-2">{e.description}</p>

        {e.external_url && (
          <a
            href={e.external_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-green-600 mt-1.5 inline-block"
          >
            More info →
          </a>
        )}

        {/* Organizer + attendee avatars */}
        <div className="flex items-center justify-between mt-2">
          {e.organizer ? (
            <p className="text-[10px] text-green-900/35">
              Hosted by {isOrganizer ? 'you' : `${e.organizer.first_name} ${e.organizer.last_name}`}
            </p>
          ) : <span />}

          {attendees.length > 0 && (
            <AttendeeStack attendees={attendees} onSelect={onSelectAttendee} />
          )}
        </div>

        {isEditing ? (
          <EventEditForm event={e} onSave={onSaveEdit} onCancel={onCancelEdit} />
        ) : isPending ? (
          <p className="text-[11px] text-green-900/35 mt-2 italic">
            Awaiting admin approval
          </p>
        ) : isOrganizer ? (
          <p className="text-[11px] text-green-900/35 mt-3 italic">
            You&apos;re hosting this event
          </p>
        ) : (
          <div className="flex gap-1.5 mt-3">
            {(['attending', 'maybe', 'declined'] as const).map(status => {
              const active = rsvpStatus === status
              const activeStyle =
                status === 'attending' ? { background: 'var(--color-green-900)', color: 'white', borderColor: 'transparent' }
                : status === 'maybe'   ? { background: 'rgba(234,179,8,0.9)', color: 'white', borderColor: 'transparent' }
                :                        { background: 'rgba(220,38,38,0.8)', color: 'white', borderColor: 'transparent' }
              return (
                <button
                  key={status}
                  onClick={() => onRSVP(status)}
                  className="flex-1 py-1.5 rounded-lg text-[11px] font-medium transition-all border"
                  style={active ? activeStyle : {
                    background: 'transparent',
                    color: 'rgba(0,38,105,0.4)',
                    borderColor: 'rgba(0,38,105,0.1)',
                  }}
                >
                  {status === 'attending' ? '✓ Going' : status === 'maybe' ? '? Maybe' : '✕ No'}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ---- Inline edit form ---------------------------------------

function EventEditForm({
  event: e,
  onSave,
  onCancel,
}: {
  event: MemberEvent
  onSave: (payload: Partial<MemberEvent>) => void
  onCancel: () => void
}) {
  const today = new Date().toISOString().split('T')[0]!
  const [title,       setTitle]       = useState(e.title)
  const [description, setDescription] = useState(e.description)
  const [date,        setDate]        = useState(e.event_date)
  const [endDate,     setEndDate]     = useState(e.event_end_date ?? '')
  const [time,        setTime]        = useState(e.event_time.slice(0, 5))
  const [location,    setLocation]    = useState(e.location ?? '')
  const [url,         setUrl]         = useState(e.external_url ?? '')
  const [saving,      setSaving]      = useState(false)

  async function handleSave() {
    if (!title || !description || !date || !time || !location) return
    setSaving(true)
    await onSave({
      title,
      description,
      event_date: date,
      event_end_date: endDate && endDate > date ? endDate : null,
      event_time: time + ':00',
      location,
      external_url: url.trim() || null,
    })
    setSaving(false)
  }

  const inputCls = 'w-full text-xs border border-green-900/12 rounded-lg px-2.5 py-1.5 outline-none focus:border-green-700 bg-white'

  return (
    <div className="mt-3 space-y-2 border-t border-green-900/08 pt-3">
      <input className={inputCls} placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} />
      <textarea className={`${inputCls} resize-none`} rows={2} placeholder="Description" value={description} onChange={e => setDescription(e.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        <input type="date" className={inputCls} min={today} value={date}
          onChange={e => { setDate(e.target.value); if (endDate && endDate < e.target.value) setEndDate('') }} />
        <input type="time" className={inputCls} value={time} onChange={e => setTime(e.target.value)} />
      </div>
      <input type="date" className={inputCls} min={date || today} value={endDate}
        onChange={e => setEndDate(e.target.value)} placeholder="End date (optional)" />
      <input className={inputCls} placeholder="Location" value={location} onChange={e => setLocation(e.target.value)} />
      <input type="url" className={inputCls} placeholder="Link (optional)" value={url} onChange={e => setUrl(e.target.value)} />
      {e.status === 'published' && (
        <p className="text-[10px] text-amber-600 italic">Editing a published event sends it back for admin review.</p>
      )}
      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={saving || !title || !description || !date || !time || !location}
          className="flex-1 py-1.5 rounded-lg text-[11px] font-semibold bg-green-900 text-white disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button onClick={onCancel} className="flex-1 py-1.5 rounded-lg text-[11px] font-medium text-green-900/50 bg-green-900/06">
          Cancel
        </button>
      </div>
    </div>
  )
}

// ---- Attendee avatar stack ----------------------------------

const MAX_VISIBLE = 5

function AttendeeStack({
  attendees,
  onSelect,
}: {
  attendees: Attendee[]
  onSelect: (memberId: string) => void
}) {
  const visible  = attendees.slice(0, MAX_VISIBLE)
  const overflow = attendees.length - MAX_VISIBLE

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center">
        {visible.map((a, i) => {
          const initials = `${a.first_name[0] ?? ''}${a.last_name[0] ?? ''}`.toUpperCase()
          return (
            <button
              key={a.member_id}
              type="button"
              title={`${a.first_name} ${a.last_name}`}
              onClick={() => onSelect(a.member_id)}
              className="w-6 h-6 rounded-full overflow-hidden flex items-center justify-center border-2 border-white flex-shrink-0 focus:outline-none"
              style={{
                marginLeft: i === 0 ? 0 : -6,
                zIndex: MAX_VISIBLE - i,
                background: 'rgba(0,38,105,0.1)',
                color: 'var(--color-green-900)',
                fontSize: 9,
                fontWeight: 700,
              }}
            >
              {a.avatar_url ? (
                <Image src={a.avatar_url} alt={initials} width={24} height={24} className="w-full h-full object-cover" />
              ) : (
                initials
              )}
            </button>
          )
        })}
        {overflow > 0 && (
          <div
            className="w-6 h-6 rounded-full flex items-center justify-center border-2 border-white flex-shrink-0"
            style={{ marginLeft: -6, zIndex: 0, background: 'rgba(0,38,105,0.08)', color: 'rgba(0,38,105,0.5)', fontSize: 8, fontWeight: 700 }}
          >
            +{overflow}
          </div>
        )}
      </div>
      <p className="text-[10px] text-green-900/40">
        {attendees.length} going
      </p>
    </div>
  )
}

// ---- Submit event form --------------------------------------

interface EventFormValues {
  title: string
  description: string
  event_date: string
  event_end_date: string
  event_time: string
  location: string
  external_url: string
}

function SubmitEventForm({
  onSubmitted,
}: {
  onSubmitted: (newEvent: MemberEvent) => void
}) {
  const todayStr = new Date().toISOString().split('T')[0]!
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<EventFormValues>({
    mode: 'onTouched',
    defaultValues: {
      title: '', description: '', event_date: '', event_end_date: '',
      event_time: '', location: '', external_url: '',
    },
  })

  const watchedDate = watch('event_date')

  async function onValid(values: EventFormValues) {
    setServerError(null)
    const res = await apiClient.post<MemberEvent>('/api/events', {
      title:        values.title.trim(),
      description:  values.description.trim(),
      event_date:   values.event_date,
      event_end_date: values.event_end_date && values.event_end_date > values.event_date
        ? values.event_end_date : null,
      event_time:   values.event_time + ':00',
      location:     values.location.trim(),
      external_url: values.external_url.trim() || null,
    })
    if (res.error) {
      setServerError(typeof res.error === 'string' ? res.error : 'Something went wrong. Please try again.')
      return
    }
    if (res.data) onSubmitted(res.data)
  }

  return (
    <form onSubmit={handleSubmit(onValid)} noValidate className="px-5 py-5 pb-8 space-y-4">
      <div className="card card-pad space-y-1">
        <p className="text-xs text-green-900/45 leading-relaxed">
          Events are reviewed before posting. Please only submit events relevant to the business community.
        </p>
      </div>

      <Field label="Event title" error={errors.title?.message}>
        <input
          className={`input ${errors.title ? 'border-red-300 focus:border-red-400' : ''}`}
          placeholder="Annual client reception…"
          {...register('title', {
            required: 'Title is required',
            minLength: { value: 3, message: 'At least 3 characters' },
            maxLength: { value: 100, message: 'Max 100 characters' },
          })}
        />
      </Field>

      <Field label="Description" error={errors.description?.message}>
        <textarea
          className={`input resize-none ${errors.description ? 'border-red-300 focus:border-red-400' : ''}`}
          rows={3}
          placeholder="What is this event? Who should attend?"
          {...register('description', {
            required: 'Description is required',
            minLength: { value: 10, message: 'At least 10 characters' },
            maxLength: { value: 2000, message: 'Max 2000 characters' },
          })}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Start date" error={errors.event_date?.message}>
          <input
            type="date"
            className={`input ${errors.event_date ? 'border-red-300 focus:border-red-400' : ''}`}
            min={todayStr}
            {...register('event_date', {
              required: 'Start date is required',
              validate: v => v >= todayStr || 'Date must be today or later',
            })}
          />
        </Field>
        <Field label="Start time" error={errors.event_time?.message}>
          <input
            type="time"
            className={`input ${errors.event_time ? 'border-red-300 focus:border-red-400' : ''}`}
            {...register('event_time', { required: 'Start time is required' })}
          />
        </Field>
      </div>

      <Field label="End date (optional — for multi-day events)" error={errors.event_end_date?.message}>
        <input
          type="date"
          className={`input ${errors.event_end_date ? 'border-red-300 focus:border-red-400' : ''}`}
          min={watchedDate || todayStr}
          {...register('event_end_date', {
            validate: v => !v || !watchedDate || v >= watchedDate || 'End date must be on or after start date',
          })}
        />
      </Field>

      <Field label="Location" error={errors.location?.message}>
        <input
          className={`input ${errors.location ? 'border-red-300 focus:border-red-400' : ''}`}
          placeholder="Venue name and address"
          {...register('location', {
            required: 'Location is required',
            minLength: { value: 2, message: 'At least 2 characters' },
            maxLength: { value: 200, message: 'Max 200 characters' },
          })}
        />
      </Field>

      <Field label="Website or registration link (optional)" error={errors.external_url?.message}>
        <input
          type="url"
          className={`input ${errors.external_url ? 'border-red-300 focus:border-red-400' : ''}`}
          placeholder="https://…"
          {...register('external_url', {
            validate: v => !v || /^https?:\/\/.+\..+/.test(v.trim()) || 'Enter a valid URL starting with https://',
          })}
        />
      </Field>

      {serverError && (
        <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {serverError}
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="btn btn-gold btn-full mt-2"
      >
        {isSubmitting ? <Spinner className="w-4 h-4 text-green-900" /> : 'Submit for review'}
      </button>
    </form>
  )
}

function Field({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="text-xs text-green-900/50 mb-1.5 block">{label}</label>
      {children}
      {error && <p className="text-[11px] text-red-500 mt-1">{error}</p>}
    </div>
  )
}

