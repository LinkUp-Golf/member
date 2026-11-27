'use client'

// An admin putting players on a tee time — a new one, or one already booked
// (opened from a tee time on the list, with its venue, day and time filled in).
//
// A name is all each player needs; email and phone are optional. Nothing here
// asks whether someone is a member or a guest, and nothing limits how many
// players, the day, or the time — POST /api/admin/bookings decides what to do
// with each person (see @/lib/bookings/admin-players).

import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { createClient } from '@/lib/supabase'
import Select from '@/components/ui/Select'
import { formatTeeTime } from '@/lib/utils'
import { validateEmail } from '@/lib/validation'
import { slotWallTime, useVenueSlots } from '@/hooks/useVenueSlots'

interface VenueOption {
  id: string
  name: string
}

interface PlayerDraft {
  key: string
  name: string
  email: string
  phone: string
}

/** A tee time the drawer opens on, from the list. */
export interface AddPlayersPreset {
  courseId: string
  /** 'YYYY-MM-DD' */
  date: string
  /** 'HH:MM' or 'HH:MM:SS' */
  teeTime: string
}

function newPlayer(): PlayerDraft {
  return { key: `${Date.now()}-${Math.random()}`, name: '', email: '', phone: '' }
}

function playerError(p: PlayerDraft): string | null {
  if (!p.name.trim()) return 'Enter a name.'
  if (p.email.trim() && !validateEmail(p.email.trim()).valid) return 'That email isn’t valid.'
  if (p.phone.trim() && p.phone.replace(/\D/g, '').length < 7) return 'That phone number looks too short.'
  return null
}

export default function AdminNewBookingDrawer({
  defaultCourseId,
  preset,
  onClose,
  onBooked,
}: {
  /** Pre-selects the venue when the page is already scoped to one. */
  defaultCourseId?: string | null
  /** Opens on an existing tee time. */
  preset?: AddPlayersPreset | null
  onClose: () => void
  onBooked: (message: string, ok: boolean) => void
}) {
  const [venues, setVenues] = useState<VenueOption[]>([])
  const [courseId, setCourseId] = useState(preset?.courseId ?? defaultCourseId ?? '')
  const [date, setDate] = useState(preset?.date ?? '')
  // 'HH:MM' at the venue — picked from the open tee times, or typed.
  const [teeTime, setTeeTime] = useState(preset ? preset.teeTime.slice(0, 5) : '')
  const [players, setPlayers] = useState<PlayerDraft[]>([newPlayer()])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [showErrors, setShowErrors] = useState(false)

  useEffect(() => {
    createClient()
      .from('courses')
      .select('id, name')
      .eq('active', true)
      .eq('approval_status', 'active')
      .not('ghl_calendar_id', 'is', null)
      .order('name')
      .then(({ data }) => setVenues((data ?? []) as VenueOption[]))
  }, [])

  const venue = venues.find(v => v.id === courseId) ?? null

  // The tee times the calendar has open, offered as shortcuts. Any other time
  // can be typed — a full tee time is no longer on this list.
  const { openSlots, loading: loadingSlots } = useVenueSlots(courseId, date)
  const openTimes = openSlots.map(s => ({ time: slotWallTime(s.startTime), spotsOpen: s.spotsOpen }))

  function updatePlayer(key: string, patch: Partial<PlayerDraft>) {
    setPlayers(ps => ps.map(p => (p.key === key ? { ...p, ...patch } : p)))
  }

  const ready = !!courseId && !!date && !!teeTime && players.length > 0 && players.every(p => playerError(p) === null)

  async function submit() {
    if (!ready) {
      setShowErrors(true)
      setError(!courseId || !date || !teeTime ? 'Choose a venue, a date and a tee time.' : '')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/admin/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseId,
          date,
          teeTime,
          players: players.map(p => ({
            name: p.name.trim(),
            email: p.email.trim() || null,
            phone: p.phone.trim() || null,
          })),
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string; added?: number; warnings?: string[] }
      if (!res.ok) {
        setError(json.error ?? 'Failed to add the players.')
        return
      }
      const n = json.added ?? players.length
      const when = `${format(new Date(`${date}T12:00:00`), 'EEE, MMM d')} at ${formatTeeTime(`${teeTime}:00`)}`
      const done = `Added ${n} player${n === 1 ? '' : 's'} at ${venue?.name ?? 'the venue'} on ${when}.`
      const warnings = json.warnings ?? []
      onBooked(warnings.length ? `${done} ${warnings.join(' ')}` : done, warnings.length === 0)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const label = 'text-[11px] font-semibold text-gray-400 uppercase tracking-wide'
  const input = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-900/20 bg-white'
  const trigger = 'w-full text-sm px-3 py-2 border border-gray-200 rounded-lg flex items-center justify-between gap-2 bg-white'

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full max-w-lg h-full overflow-y-auto shadow-2xl flex flex-col">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-900">{preset ? 'Add players' : 'New booking'}</h2>
            <p className="text-xs text-gray-500">Put anyone on a tee time — a name is all that’s needed.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-full flex items-center justify-center bg-gray-100 text-gray-500">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-5 space-y-5 flex-1">
          {/* Venue + day */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1 min-w-0">
              <span className={label}>Venue</span>
              <Select
                value={courseId}
                onChange={v => { setCourseId(v); setTeeTime('') }}
                options={venues.map(v => ({ value: v.id, label: v.name }))}
                placeholder="Choose a venue"
                searchPlaceholder="Search venues…"
                className="w-full"
                triggerClassName={trigger}
              />
            </div>
            <label className="flex flex-col gap-1">
              <span className={label}>Date</span>
              <input
                type="date"
                value={date}
                onChange={e => { setDate(e.target.value); setTeeTime('') }}
                className={input}
              />
            </label>
          </div>

          {/* Tee time */}
          {courseId && date && (
            <div className="flex flex-col gap-1.5">
              <span className={label}>Tee time</span>
              {loadingSlots ? (
                <p className="text-xs text-gray-400">Loading tee times…</p>
              ) : openTimes.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {openTimes.map(s => (
                    <button
                      key={s.time}
                      type="button"
                      onClick={() => setTeeTime(s.time)}
                      className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                        teeTime === s.time
                          ? 'bg-green-900 text-white border-green-900'
                          : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      {formatTeeTime(`${s.time}:00`)}
                      <span className="font-normal opacity-70"> · {s.spotsOpen} open</span>
                    </button>
                  ))}
                </div>
              ) : null}
              <label className="flex items-center gap-2 text-xs text-gray-500">
                <span className="whitespace-nowrap">{openTimes.length > 0 ? 'Or any time:' : 'Time:'}</span>
                <input
                  type="time"
                  value={teeTime}
                  onChange={e => setTeeTime(e.target.value.slice(0, 5))}
                  className={`${input} max-w-[10rem]`}
                />
              </label>
            </div>
          )}

          {/* Players */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className={label}>Players</span>
              <span className="text-[11px] text-gray-400">{players.length}</span>
            </div>

            {players.map((p, i) => {
              const err = showErrors ? playerError(p) : null
              return (
                <div key={p.key} className="rounded-xl border border-gray-100 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-gray-700">Player {i + 1}</p>
                    {players.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setPlayers(ps => ps.filter(x => x.key !== p.key))}
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <input
                    className={input}
                    placeholder="Name (required)"
                    value={p.name}
                    maxLength={100}
                    onChange={e => updatePlayer(p.key, { name: e.target.value })}
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input className={input} type="email" placeholder="Email (optional)" value={p.email} onChange={e => updatePlayer(p.key, { email: e.target.value })} />
                    <input className={input} type="tel" placeholder="Phone (optional)" value={p.phone} onChange={e => updatePlayer(p.key, { phone: e.target.value })} />
                  </div>
                  {err && <p className="text-[11px] text-red-600">{err}</p>}
                </div>
              )
            })}

            <button
              type="button"
              onClick={() => setPlayers(ps => [...ps, newPlayer()])}
              className="w-full py-2.5 rounded-xl border-2 border-dashed border-gray-200 text-sm font-medium text-gray-500 hover:bg-gray-50"
            >
              + Add another player
            </button>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="px-5 py-4 border-t border-gray-100">
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="w-full py-3 rounded-xl bg-green-900 text-white font-semibold hover:bg-green-800 disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Adding…' : `Add ${players.length} player${players.length === 1 ? '' : 's'}`}
          </button>
          <p className="text-[11px] text-gray-400 text-center mt-2">
            Anyone with an email gets the round in their app, and the reminders.
          </p>
        </div>
      </div>
    </div>
  )
}
