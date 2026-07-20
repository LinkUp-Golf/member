'use client'

// Host: create and manage hosted events. Draft → publish → (event runs) →
// upload proof → pending approval → credits awarded. Cancelling frees any
// reserved spots.

import { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react'
import Link from 'next/link'
import { useForm, Controller } from 'react-hook-form'
import { AdminPageHeader, AdminCard, Badge, ProgressBar } from '@/components/admin/AdminUI'
import { Spinner } from '@/components/ui/Loading'
import Select, { type SelectOption } from '@/components/ui/Select'
import { HOST_MEMBER_PRICE_MARKUP_USD } from '@/lib/constants'
import { memberPrice, canUploadProof } from '@/lib/hosts/events'
import type { HostedEvent, HostedEventStatus, Course, HostBookingOption } from '@/types'

const fmtMoney = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fmtDate = (d: string) =>
  new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })

const fmtTime = (t: string | null) => {
  if (!t) return null
  const [h, m] = t.split(':')
  const hour = Number(h)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const h12 = hour % 12 || 12
  return `${h12}:${m} ${ampm}`
}

const STATUS_META: Record<HostedEventStatus, { label: string; colour: 'green' | 'gold' | 'red' | 'blue' | 'gray' }> = {
  draft:                   { label: 'Draft',              colour: 'gray' },
  pending_review:          { label: 'Awaiting review',    colour: 'gold' },
  upcoming:                { label: 'Upcoming',           colour: 'green' },
  completed:               { label: 'Completed',          colour: 'blue' },
  pending_credit_approval: { label: 'Credit approval',    colour: 'gold' },
  credits_awarded:         { label: 'Credits awarded',    colour: 'green' },
  cancelled:               { label: 'Cancelled',          colour: 'red' },
}

export default function HostEventsPage() {
  const [events, setEvents] = useState<HostedEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [editing, setEditing] = useState<HostedEvent | 'new' | null>(null)

  const showToast = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }, [])

  const load = useCallback(async () => {
    const res = await fetch('/api/host/events')
    const json = await res.json().catch(() => ({}))
    if (res.ok) setEvents(Array.isArray(json.events) ? json.events : [])
    else showToast(json.error ?? 'Could not load events.', false)
    setLoading(false)
  }, [showToast])

  useEffect(() => { load() }, [load])

  // One stable callback for every row, so the memoized cards don't re-render
  // whenever this page does.
  const handleEdit = useCallback((e: HostedEvent) => setEditing(e), [])
  const handleNew = useCallback(() => setEditing('new'), [])

  return (
    <div className="p-4 sm:p-8 max-w-4xl mx-auto">
      <AdminPageHeader
        title="My Events"
        description="Create rounds members can reserve, then earn credits once they run."
        action={<button onClick={handleNew} className="btn btn-gold btn-sm">New event</button>}
      />

      {loading ? (
        <div className="py-16 text-center text-sm text-gray-400">Loading…</div>
      ) : events.length === 0 ? (
        <AdminCard>
          <div className="py-10 text-center">
            <p className="text-sm text-gray-500">You haven&apos;t created any events yet.</p>
            <button onClick={handleNew} className="btn btn-gold btn-sm mt-4">Create your first event</button>
          </div>
        </AdminCard>
      ) : (
        <div className="space-y-3">
          {events.map(e => (
            <EventCard key={e.id} event={e} onChanged={load} onToast={showToast} onEdit={handleEdit} />
          ))}
        </div>
      )}

      {editing && (
        <EventDrawer
          event={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(msg) => { setEditing(null); showToast(msg); load() }}
          onError={(msg) => showToast(msg, false)}
        />
      )}

      {toast && (
        <div className={`fixed top-6 right-6 z-[60] px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${toast.ok ? 'bg-green-900 text-white' : 'bg-red-600 text-white'}`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}

// ---- Event card ---------------------------------------------

const EventCard = memo(function EventCard({ event, onChanged, onToast, onEdit }: {
  event: HostedEvent
  onChanged: () => void
  onToast: (msg: string, ok?: boolean) => void
  /** Takes the event so the parent can pass one stable callback for every row. */
  onEdit: (event: HostedEvent) => void
}) {
  const [busy, setBusy] = useState(false)
  const meta = STATUS_META[event.status]
  const filled = event.filled_spots ?? 0
  // Mirrors the server's editable/cancellable set — a host can still fix an
  // event while it's awaiting review.
  const editable = event.status === 'draft' || event.status === 'pending_review' || event.status === 'upcoming'
  const canProof = canUploadProof(event.status, event.event_date)

  async function act(action: string, extra: Record<string, unknown> = {}) {
    if (busy) return
    setBusy(true)
    const res = await fetch(`/api/host/events/${event.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...extra }),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { onToast(json.error ?? 'Action failed.', false); return }
    onToast(
      action === 'publish' ? 'Submitted for review.'
        : action === 'cancel' ? 'Event cancelled.'
        : 'Saved.'
    )
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
            {fmtDate(event.event_date)}{event.tee_time ? ` · ${fmtTime(event.tee_time)}` : ''}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            {fmtMoney(event.member_price ?? memberPrice(event.member_guest_rate))} member
            <span className="text-gray-300"> · </span>
            {fmtMoney(event.member_guest_rate)} guest rate
          </p>
        </div>
        <Link
          href={`/host/events/${event.id}`}
          className="text-xs font-medium text-gray-500 hover:text-green-800 flex-shrink-0 whitespace-nowrap"
        >
          {filled} registered →
        </Link>
      </div>

      {/* Spots */}
      <div className="mt-3">
        <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
          <span>{filled} of {event.total_spots} spots filled</span>
          <span>{event.remaining_spots ?? (event.total_spots - filled)} left</span>
        </div>
        <ProgressBar value={filled} max={event.total_spots} />
      </div>

      {event.description && (
        <p className="text-xs text-gray-500 mt-3 whitespace-pre-wrap">{event.description}</p>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2 mt-4">
        {editable && (
          <button onClick={() => onEdit(event)} disabled={busy} className="btn btn-outline btn-sm">Edit</button>
        )}
        {event.status === 'draft' && (
          <button onClick={() => act('publish')} disabled={busy} className="btn btn-gold btn-sm">Submit for review</button>
        )}
        {canProof && (
          <ProofControl event={event} onDone={onChanged} onToast={onToast} />
        )}
        {editable && (
          <CancelButton event={event} busy={busy} onCancelReason={(reason) => act('cancel', { cancellation_reason: reason })} />
        )}
      </div>

      {event.status === 'pending_review' && (
        <p className="text-[11px] text-amber-600 mt-3">
          Submitted — an admin will review it before members can see it.
        </p>
      )}
      {event.status === 'draft' && event.rejection_reason && (
        <p className="text-[11px] text-red-600 mt-3">
          Sent back by an admin: {event.rejection_reason} — edit and submit again.
        </p>
      )}
      {event.status === 'pending_credit_approval' && (
        <p className="text-[11px] text-amber-600 mt-3">Proof submitted — awaiting admin approval for your credit.</p>
      )}
      {event.source_booking_id && (
        <p className="text-[11px] text-gray-400 mt-2">
          Listed from an existing booking — course, date, and tee time are fixed.
        </p>
      )}
      {event.status === 'cancelled' && event.cancellation_reason && (
        <p className="text-[11px] text-gray-400 mt-3">Reason: {event.cancellation_reason}</p>
      )}
    </div>
  )
})

// ---- Cancel with optional reason ----------------------------

function CancelButton({ event, onCancelReason, busy }: {
  event: HostedEvent
  onCancelReason: (reason: string) => void
  busy: boolean
}) {
  const [confirming, setConfirming] = useState(false)
  const [reason, setReason] = useState('')
  const hasRegs = (event.filled_spots ?? 0) > 0

  if (!confirming) {
    return <button onClick={() => setConfirming(true)} disabled={busy} className="btn btn-outline btn-sm text-red-600 border-red-200">Cancel</button>
  }
  return (
    <div className="w-full mt-1 p-3 rounded-xl bg-red-50 border border-red-100 space-y-2">
      <p className="text-xs text-red-700">
        Cancel this event{hasRegs ? ` and release all ${event.filled_spots} reserved spot${event.filled_spots === 1 ? '' : 's'}` : ''}?
      </p>
      <input
        className="input text-sm"
        placeholder="Reason (optional, shown to members)"
        value={reason}
        onChange={e => setReason(e.target.value)}
      />
      <div className="flex gap-2">
        <button onClick={() => setConfirming(false)} disabled={busy} className="btn btn-outline btn-sm flex-1">Keep it</button>
        <button onClick={() => onCancelReason(reason.trim())} disabled={busy} className="btn btn-sm flex-1 bg-red-600 text-white">Cancel event</button>
      </div>
    </div>
  )
}

// ---- Proof upload -------------------------------------------

function ProofControl({ event, onDone, onToast }: {
  event: HostedEvent
  onDone: () => void
  onToast: (msg: string, ok?: boolean) => void
}) {
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function upload(file: File) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { onToast('Use a JPG, PNG, or WebP image.', false); return }
    if (file.size > 10 * 1024 * 1024) { onToast('Image must be under 10 MB.', false); return }
    setUploading(true)
    const data = new FormData()
    data.append('file', file)
    const res = await fetch(`/api/host/events/${event.id}/proof`, { method: 'POST', body: data })
    const json = await res.json().catch(() => ({}))
    setUploading(false)
    if (!res.ok) { onToast(json.error ?? 'Upload failed.', false); return }
    onToast('Proof submitted for approval.')
    onDone()
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }}
      />
      <button onClick={() => inputRef.current?.click()} disabled={uploading} className="btn btn-gold btn-sm">
        {uploading ? 'Uploading…' : event.status === 'pending_credit_approval' ? 'Replace proof' : 'Upload proof'}
      </button>
    </>
  )
}

// ---- Create / edit drawer -----------------------------------

interface EventFormValues {
  course_id: string
  event_date: string
  /** '' means "no fixed tee time". */
  tee_time: string
  total_spots: number | ''
  member_guest_rate: number | ''
  description: string
  /** Set when listing one of the host's existing bookings. */
  source_booking_id: string
}

/** A tee time offered by the course on the chosen date. */
interface TeeSlot {
  /** Course-local wall clock, HH:MM — what we store in hosted_events.tee_time. */
  value: string
  label: string
  spotsOpen: number | null
}

const NO_TEE_TIME = ''

function EventDrawer({ event, onClose, onSaved, onError }: {
  event: HostedEvent | null
  onClose: () => void
  onSaved: (msg: string) => void
  onError: (msg: string) => void
}) {
  const isEdit = !!event
  const [courses, setCourses] = useState<Pick<Course, 'id' | 'name' | 'city'>[]>([])
  const [slots, setSlots] = useState<TeeSlot[]>([])
  const [slotsState, setSlotsState] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle')
  const [bookings, setBookings] = useState<HostBookingOption[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  // A new event is either listed from a tee time the host already holds, or
  // proposed from scratch. Editing keeps whichever it was created as.
  const [mode, setMode] = useState<'booking' | 'new'>(event?.source_booking_id ? 'booking' : 'new')
  const fromBooking = mode === 'booking'

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm<EventFormValues>({
    defaultValues: {
      course_id: event?.course_id ?? '',
      event_date: event?.event_date?.slice(0, 10) ?? '',
      tee_time: event?.tee_time?.slice(0, 5) ?? NO_TEE_TIME,
      total_spots: event?.total_spots ?? '',
      member_guest_rate: event?.member_guest_rate ?? '',
      description: event?.description ?? '',
      source_booking_id: event?.source_booking_id ?? '',
    },
  })

  const courseId = watch('course_id')
  const eventDate = watch('event_date')
  const rate = watch('member_guest_rate')
  const bookingId = watch('source_booking_id')
  const selectedBooking = bookings.find(b => b.id === bookingId) ?? null
  // Spots offered can never exceed the seats the linked booking holds.
  const spotCap = selectedBooking?.seats ?? 200

  // A failed load leaves an empty dropdown with no explanation, so surface it
  // rather than swallowing the error.
  useEffect(() => {
    let cancelled = false

    Promise.all([
      fetch('/api/courses').then(r => r.ok ? r.json() : Promise.reject(new Error('courses'))),
      fetch('/api/host/bookings').then(r => r.ok ? r.json() : Promise.reject(new Error('bookings'))),
    ])
      .then(([coursesJson, bookingsJson]) => {
        if (cancelled) return
        setCourses(coursesJson.courses ?? [])
        setBookings(bookingsJson.bookings ?? [])
      })
      .catch(() => { if (!cancelled) setLoadError('Could not load courses and bookings. Close and reopen to retry.') })

    return () => { cancelled = true }
  }, [])

  // Tee times come from the course's real availability for that date (the same
  // source the booking screen uses), so a host can only pick a slot the course
  // actually offers rather than typing an arbitrary time.
  useEffect(() => {
    if (!courseId || !eventDate) { setSlots([]); setSlotsState('idle'); return }

    let cancelled = false
    setSlotsState('loading')
    const month = eventDate.slice(0, 7)

    fetch(`/api/bookings/create?month=${month}&courseId=${courseId}`)
      .then(r => r.json())
      .then(j => {
        if (cancelled) return
        const forDate: { startTime: string; spotsOpen?: number }[] = j?.slots?.[eventDate] ?? []
        setSlots(forDate.map(s => {
          // startTime carries the course's own UTC offset, so the wall-clock
          // time at the venue is exactly the HH:MM in the string.
          const hhmm = s.startTime.slice(11, 16)
          return { value: hhmm, label: fmtTime(hhmm) ?? hhmm, spotsOpen: s.spotsOpen ?? null }
        }))
        setSlotsState('loaded')
      })
      .catch(() => { if (!cancelled) { setSlots([]); setSlotsState('error') } })

    return () => { cancelled = true }
  }, [courseId, eventDate])

  // Same helper the server uses, so the preview can't drift from the real price.
  const previewPrice = rate !== '' && Number.isFinite(Number(rate)) ? memberPrice(Number(rate)) : null

  // Select is memoized on its props, so these must be stable across renders —
  // rebuilding the arrays every keystroke would re-render the whole dropdown.
  const courseOptions: SelectOption[] = useMemo(
    () => courses.map(c => ({
      value: c.id,
      label: c.city ? `${c.name} — ${c.city}` : c.name,
    })),
    [courses]
  )

  const bookingOptions: SelectOption[] = useMemo(
    () => bookings
      // An already-listed booking can't be listed again (the DB enforces it too).
      .filter(b => !b.already_listed || b.id === bookingId)
      .map(b => ({
        value: b.id,
        label: `${b.course_name ?? 'Course'} · ${fmtDate(b.booking_date)} · ${fmtTime(b.tee_time) ?? b.tee_time} · ${b.seats} seat${b.seats === 1 ? '' : 's'}${b.booked_by ? ` · ${b.booked_by}` : ''}`,
      })),
    [bookings, bookingId]
  )

  const currentTee = watch('tee_time')
  const teeOptions: SelectOption[] = useMemo(
    () => [
      { value: NO_TEE_TIME, label: 'No specific tee time' },
      ...slots.map(s => ({
        value: s.value,
        label: s.spotsOpen !== null ? `${s.label} · ${s.spotsOpen} open` : s.label,
      })),
      // An already-saved tee time may no longer be in the course's published
      // availability — keep it selectable so editing doesn't silently drop it.
      ...(currentTee && !slots.some(s => s.value === currentTee)
        ? [{ value: currentTee, label: `${fmtTime(currentTee) ?? currentTee} (currently set)` }]
        : []),
    ],
    [slots, currentTee]
  )

  const field = 'input text-sm'
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1'
  const errCls = 'text-xs text-red-500 mt-1'

  async function save(values: EventFormValues, publish: boolean) {
    // When listing a booking the server derives course/date/tee time from the
    // booking itself; sending them would be ignored (and is rejected on edit).
    const linked = fromBooking && values.source_booking_id
    const payload = linked
      ? {
          source_booking_id: values.source_booking_id,
          total_spots: Number(values.total_spots),
          member_guest_rate: Number(values.member_guest_rate),
          description: values.description.trim() || null,
        }
      : {
          course_id: values.course_id,
          event_date: values.event_date,
          tee_time: values.tee_time || null,
          total_spots: Number(values.total_spots),
          member_guest_rate: Number(values.member_guest_rate),
          description: values.description.trim() || null,
        }

    const res = isEdit && event
      ? await fetch(`/api/host/events/${event.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'update', ...payload }),
        })
      : await fetch('/api/host/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, publish }),
        })

    const json = await res.json().catch(() => ({}))
    if (!res.ok) { onError(json.error ?? 'Could not save.'); return }
    onSaved(isEdit ? 'Event updated.' : publish ? 'Submitted for review.' : 'Draft saved.')
  }

  const submit = (publish: boolean) => handleSubmit(v => save(v, publish))()

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full max-w-md h-full overflow-y-auto shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-lg font-bold text-gray-900">{isEdit ? 'Edit event' : 'New event'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        <form className="flex-1 overflow-y-auto px-6 py-6 space-y-4" noValidate onSubmit={e => e.preventDefault()}>
          {loadError && (
            <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-xs text-red-700">
              {loadError}
            </div>
          )}

          {/* Source: an existing booking, or a newly proposed schedule. */}
          {!isEdit && (
            <div className="flex gap-2 p-1 bg-gray-100 rounded-xl">
              {([
                { key: 'booking', label: 'Existing booking' },
                { key: 'new', label: 'New schedule' },
              ] as const).map(m => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => {
                    setMode(m.key)
                    // The two modes source course/date/tee time differently.
                    setValue('source_booking_id', '')
                    setValue('course_id', '')
                    setValue('event_date', '')
                    setValue('tee_time', NO_TEE_TIME)
                    // Errors from the other mode's required fields no longer apply.
                    clearErrors(['source_booking_id', 'course_id', 'event_date'])
                  }}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                    mode === m.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}

          {fromBooking ? (
            <>
              <div>
                <label htmlFor="ev-booking" className={labelCls}>Existing booking *</label>
                <Controller
                  name="source_booking_id"
                  control={control}
                  rules={{ required: fromBooking ? 'Choose one of your bookings' : false }}
                  render={({ field: f }) => (
                    <Select
                      id="ev-booking"
                      options={bookingOptions}
                      value={f.value}
                      onChange={f.onChange}
                      disabled={isEdit}
                      placeholder={bookingOptions.length ? 'Select a booking…' : 'No active bookings available'}
                      searchPlaceholder="Search by course, date or member…"
                    />
                  )}
                />
                {errors.source_booking_id && <p className={errCls}>{errors.source_booking_id.message}</p>}
                {!isEdit && bookingOptions.length === 0 && (
                  <p className="text-[11px] text-amber-600 mt-1">
                    No active bookings are available to take on right now — switch to &quot;New schedule&quot; to propose your own.
                  </p>
                )}
              </div>

              {(selectedBooking || isEdit) && (
                <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3 text-xs text-gray-600 space-y-1">
                  {selectedBooking ? (
                    <>
                      <p><span className="text-gray-400">Course:</span> {selectedBooking.course_name ?? '—'}</p>
                      <p><span className="text-gray-400">Date:</span> {fmtDate(selectedBooking.booking_date)}</p>
                      <p><span className="text-gray-400">Tee time:</span> {fmtTime(selectedBooking.tee_time) ?? '—'}</p>
                      <p><span className="text-gray-400">Booked by:</span> {selectedBooking.booked_by ?? '—'}</p>
                      <p><span className="text-gray-400">Seats held:</span> {selectedBooking.seats}</p>
                    </>
                  ) : (
                    <p>Course, date, and tee time come from the linked booking and can&apos;t be changed.</p>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
          <div>
            <label htmlFor="ev-course" className={labelCls}>Course *</label>
            <Controller
              name="course_id"
              control={control}
              rules={{ required: fromBooking ? false : 'Choose a course' }}
              render={({ field: f }) => (
                <Select
                  id="ev-course"
                  options={courseOptions}
                  value={f.value}
                  onChange={v => {
                    f.onChange(v)
                    // Tee times belong to a course+date pair; a new course
                    // invalidates the current pick.
                    setValue('tee_time', NO_TEE_TIME)
                  }}
                  placeholder="Select a course…"
                  searchPlaceholder="Search courses…"
                />
              )}
            />
            {errors.course_id && <p className={errCls}>{errors.course_id.message}</p>}
          </div>

          <div>
            <label htmlFor="ev-date" className={labelCls}>Date *</label>
            <input
              id="ev-date"
              type="date"
              className={field}
              min={new Date().toISOString().slice(0, 10)}
              {...register('event_date', {
                required: fromBooking ? false : 'Choose a date',
                validate: v => fromBooking || !v || v >= new Date().toISOString().slice(0, 10) || 'Date cannot be in the past',
                onChange: () => setValue('tee_time', NO_TEE_TIME),
              })}
            />
            {errors.event_date && <p className={errCls}>{errors.event_date.message}</p>}
          </div>

          <div>
            <label htmlFor="ev-time" className={labelCls}>Tee time</label>
            <Controller
              name="tee_time"
              control={control}
              render={({ field: f }) => (
                <Select
                  id="ev-time"
                  options={teeOptions}
                  value={f.value}
                  onChange={f.onChange}
                  disabled={!courseId || !eventDate || slotsState === 'loading'}
                  placeholder={
                    !courseId || !eventDate ? 'Pick a course and date first'
                      : slotsState === 'loading' ? 'Loading tee times…'
                      : 'No specific tee time'
                  }
                  searchPlaceholder="Search times…"
                />
              )}
            />
            {slotsState === 'loaded' && slots.length === 0 && (
              <p className="text-[11px] text-amber-600 mt-1">
                No tee times published for this date — you can still run the event without a fixed time.
              </p>
            )}
            {slotsState === 'error' && (
              <p className="text-[11px] text-amber-600 mt-1">
                Couldn&apos;t load tee times. You can still save without a fixed time.
              </p>
            )}
          </div>
            </>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="ev-spots" className={labelCls}>Available spots *</label>
              <input
                id="ev-spots"
                type="number"
                min={1}
                max={spotCap}
                className={field}
                {...register('total_spots', {
                  required: 'Enter the number of spots',
                  valueAsNumber: true,
                  min: { value: 1, message: 'At least 1 spot' },
                  max: { value: spotCap, message: `At most ${spotCap} — the seats this booking holds` },
                  validate: v => Number.isInteger(Number(v)) || 'Whole numbers only',
                })}
              />
              {errors.total_spots && <p className={errCls}>{errors.total_spots.message}</p>}
              {selectedBooking && (
                <p className="text-[11px] text-gray-400 mt-1">Max {selectedBooking.seats} (seats you hold)</p>
              )}
            </div>
            <div>
              <label htmlFor="ev-rate" className={labelCls}>Member guest rate *</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
                <input
                  id="ev-rate"
                  type="number"
                  min={0}
                  step="1"
                  className={`${field} pl-7`}
                  {...register('member_guest_rate', {
                    required: 'Enter the guest rate',
                    valueAsNumber: true,
                    min: { value: 0, message: 'Cannot be negative' },
                  })}
                />
              </div>
              {errors.member_guest_rate && <p className={errCls}>{errors.member_guest_rate.message}</p>}
            </div>
          </div>

          {previewPrice !== null && (
            <div className="rounded-xl bg-green-50 border border-green-100 px-4 py-3 text-xs text-green-900">
              Members pay <strong>{fmtMoney(previewPrice)}</strong> — your guest rate plus the {fmtMoney(HOST_MEMBER_PRICE_MARKUP_USD)} LinkUp fee. Your credit for this event will be {fmtMoney(Number(rate))}.
            </div>
          )}

          <div>
            <label htmlFor="ev-desc" className={labelCls}>Description</label>
            <textarea
              id="ev-desc"
              rows={4}
              maxLength={2000}
              className={`${field} resize-none`}
              placeholder="Anything members should know — format, meeting point, dress code…"
              {...register('description', { maxLength: { value: 2000, message: 'At most 2000 characters' } })}
            />
            {errors.description && <p className={errCls}>{errors.description.message}</p>}
          </div>
        </form>

        <div className="px-6 py-4 border-t border-gray-100 flex gap-3 flex-shrink-0">
          {isEdit ? (
            <button type="button" onClick={() => submit(false)} disabled={isSubmitting} className="btn btn-gold btn-full justify-center">
              {isSubmitting ? <Spinner className="w-4 h-4 text-green-900" /> : 'Save changes'}
            </button>
          ) : (
            <>
              <button type="button" onClick={() => submit(false)} disabled={isSubmitting} className="btn btn-outline btn-sm flex-1 justify-center">Save draft</button>
              <button type="button" onClick={() => submit(true)} disabled={isSubmitting} className="btn btn-gold btn-sm flex-1 justify-center">
                {isSubmitting ? <Spinner className="w-4 h-4 text-green-900" /> : 'Submit for review'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
