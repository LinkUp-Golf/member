'use client'

// An admin making a booking on a member's behalf.
//
// The same steps a member takes — venue, day, tee time, then any added players
// — ending in the same POST /api/bookings/create, with onBehalfOfMemberId
// naming the member. The server holds it to every rule a member's own booking
// meets, so this form only has to offer what that route will accept:
//
//   • non-member guests only where the venue allows them (courses.
//     allow_non_member_guests — see @/lib/bookings/guest-policy);
//   • who pays for each added player, required (@/lib/bookings/invitations).

import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { createClient } from '@/lib/supabase'
import Select from '@/components/ui/Select'
import { formatTeeTime } from '@/lib/utils'
import { validateEmail } from '@/lib/validation'
import { allowsNonMemberGuests } from '@/lib/bookings/guest-policy'
import { PAID_BY_OPTIONS, type PaidBy } from '@/lib/bookings/invitations'
import type { AdditionalPlayer, GHLBookingSlot } from '@/types'

export interface BookableMember {
  id: string
  first_name: string
  last_name: string
  email: string
}

interface VenueOption {
  id: string
  name: string
  timezone: string | null
  allow_non_member_guests: boolean
}

type PlayerKind = 'member' | 'non_member'

interface PlayerDraft {
  key: string
  kind: PlayerKind
  memberId: string
  firstName: string
  lastName: string
  email: string
  mobile: string
  paidBy: PaidBy | null
}

// A booking is at most four players: the member and three more.
const MAX_ADDITIONAL = 3

function memberLabel(m: BookableMember): string {
  const name = `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim()
  return name ? `${name} · ${m.email}` : m.email
}

function slotTime(iso: string): string {
  // startTime carries the venue's own offset, so the wall-clock time is the
  // string's own — no re-zoning in the admin's browser.
  return formatTeeTime(iso.split('T')[1]?.slice(0, 8) ?? '00:00:00')
}

function newPlayer(): PlayerDraft {
  return {
    key: `${Date.now()}-${Math.random()}`,
    kind: 'member',
    memberId: '',
    firstName: '',
    lastName: '',
    email: '',
    mobile: '',
    paidBy: null,
  }
}

export default function AdminNewBookingDrawer({
  members,
  defaultCourseId,
  onClose,
  onBooked,
}: {
  members: BookableMember[]
  /** Pre-selects the venue when the page is already scoped to one. */
  defaultCourseId?: string | null
  onClose: () => void
  onBooked: (message: string) => void
}) {
  const [venues, setVenues] = useState<VenueOption[]>([])
  const [memberId, setMemberId] = useState('')
  const [courseId, setCourseId] = useState(defaultCourseId ?? '')
  const [date, setDate] = useState('')
  const [slotsByDate, setSlotsByDate] = useState<Record<string, GHLBookingSlot[]>>({})
  const [loadedMonth, setLoadedMonth] = useState('')
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [slotStart, setSlotStart] = useState('')
  const [players, setPlayers] = useState<PlayerDraft[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    createClient()
      .from('courses')
      .select('id, name, timezone, allow_non_member_guests')
      .eq('active', true)
      .eq('approval_status', 'active')
      .not('ghl_calendar_id', 'is', null)
      .order('name')
      .then(({ data }) => setVenues((data ?? []) as VenueOption[]))
  }, [])

  const venue = venues.find(v => v.id === courseId) ?? null
  const nonMembersAllowed = allowsNonMemberGuests(venue)

  // Tee times come a month at a time from the same endpoint the member's
  // booking screen reads.
  const month = date.slice(0, 7)
  useEffect(() => {
    if (!courseId || !month) return
    const key = `${courseId}|${month}`
    if (key === loadedMonth) return
    setLoadingSlots(true)
    setSlotStart('')
    fetch(`/api/bookings/create?month=${month}&courseId=${courseId}`)
      .then(r => r.json())
      .then(d => {
        setSlotsByDate(d.slots ?? {})
        setLoadedMonth(key)
      })
      .catch(() => setSlotsByDate({}))
      .finally(() => setLoadingSlots(false))
  }, [courseId, month, loadedMonth])

  const openSlots = useMemo(
    () => (slotsByDate[date] ?? []).filter(s => s.available && (s.spotsOpen ?? 0) > 0),
    [slotsByDate, date],
  )
  const slot = openSlots.find(s => s.startTime === slotStart) ?? null
  const maxAdditional = Math.min(MAX_ADDITIONAL, Math.max(0, (slot?.spotsOpen ?? 1) - 1))

  // A venue that stops allowing non-members takes those rows back to members.
  useEffect(() => {
    if (nonMembersAllowed) return
    setPlayers(ps => ps.map(p => (p.kind === 'non_member' ? { ...newPlayer(), key: p.key, paidBy: p.paidBy } : p)))
  }, [nonMembersAllowed])

  // Fewer seats at the new tee time drops the extra rows.
  useEffect(() => {
    setPlayers(ps => (ps.length > maxAdditional ? ps.slice(0, maxAdditional) : ps))
  }, [maxAdditional])

  function updatePlayer(key: string, patch: Partial<PlayerDraft>) {
    setPlayers(ps => ps.map(p => (p.key === key ? { ...p, ...patch } : p)))
  }

  const memberOptions = members
    .filter(m => m.id !== memberId)
    .map(m => ({ value: m.id, label: memberLabel(m) }))

  function playerError(p: PlayerDraft): string | null {
    if (!p.paidBy) return 'Choose who pays.'
    if (p.kind === 'member') return p.memberId ? null : 'Pick a member.'
    if (!validateEmail(p.email).valid) return 'Enter a valid email.'
    if (p.mobile.replace(/\D/g, '').length < 7) return 'Enter a phone number.'
    return null
  }

  const pickedTwice = new Set(
    players.filter(p => p.kind === 'member' && p.memberId).map(p => p.memberId),
  ).size !== players.filter(p => p.kind === 'member' && p.memberId).length

  const ready =
    !!memberId && !!courseId && !!slot && !pickedTwice && players.every(p => playerError(p) === null)

  async function submit() {
    if (!ready || !slot) return
    setSubmitting(true)
    setError('')
    const additionalPlayers: AdditionalPlayer[] = players.map(p => {
      if (p.kind === 'member') {
        const m = members.find(x => x.id === p.memberId)
        return {
          firstName: m?.first_name ?? '',
          lastName: m?.last_name ?? '',
          email: m?.email ?? '',
          mobile: '',
          memberId: p.memberId,
          isNonMember: false,
          paidBy: p.paidBy ?? undefined,
        }
      }
      return {
        firstName: p.firstName.trim(),
        lastName: p.lastName.trim(),
        email: p.email.trim(),
        mobile: p.mobile.trim(),
        isNonMember: true,
        paidBy: p.paidBy ?? undefined,
      }
    })
    try {
      const res = await fetch('/api/bookings/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startTime: slot.startTime,
          courseId,
          additionalPlayers,
          onBehalfOfMemberId: memberId,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? 'Failed to create the booking.')
        return
      }
      const booker = members.find(m => m.id === memberId)
      onBooked(
        `Booked ${booker ? `${booker.first_name} ${booker.last_name}`.trim() || booker.email : 'the member'} at ${venue?.name ?? 'the venue'} on ${format(new Date(`${date}T12:00:00`), 'EEE, MMM d')} at ${slotTime(slot.startTime)}.`,
      )
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
            <h2 className="text-base font-bold text-gray-900">New booking</h2>
            <p className="text-xs text-gray-500">Book a tee time on a member&apos;s behalf.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-full flex items-center justify-center bg-gray-100 text-gray-500">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-5 space-y-5 flex-1">
          {/* Member */}
          <div className="flex flex-col gap-1">
            <span className={label}>Member</span>
            <Select
              value={memberId}
              onChange={v => {
                setMemberId(v)
                setPlayers(ps => ps.map(p => (p.memberId === v ? { ...p, memberId: '' } : p)))
              }}
              options={members.map(m => ({ value: m.id, label: memberLabel(m) }))}
              placeholder="Choose a member"
              searchPlaceholder="Search members…"
              className="w-full"
              triggerClassName={trigger}
            />
          </div>

          {/* Venue + day */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1 min-w-0">
              <span className={label}>Venue</span>
              <Select
                value={courseId}
                onChange={v => { setCourseId(v); setSlotStart(''); setLoadedMonth('') }}
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
                min={format(new Date(), 'yyyy-MM-dd')}
                onChange={e => { setDate(e.target.value); setSlotStart('') }}
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
              ) : openSlots.length === 0 ? (
                <p className="text-xs text-gray-500">No tee times open at this venue on this day.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {openSlots.map(s => (
                    <button
                      key={s.startTime}
                      type="button"
                      onClick={() => setSlotStart(s.startTime)}
                      className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                        slotStart === s.startTime
                          ? 'bg-green-900 text-white border-green-900'
                          : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      {slotTime(s.startTime)}
                      <span className="font-normal opacity-70"> · {s.spotsOpen} open</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Added players */}
          {slot && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className={label}>Players</span>
                <span className="text-[11px] text-gray-400">{1 + players.length} / {1 + maxAdditional} spots</span>
              </div>
              {!nonMembersAllowed && (
                <p className="text-[11px] text-gray-400">This venue doesn&apos;t take non-member guests — LinkUp members only.</p>
              )}

              {players.map((p, i) => {
                const err = playerError(p)
                return (
                  <div key={p.key} className="rounded-xl border border-gray-100 p-3 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-gray-700">Player {i + 2}</p>
                      <button
                        type="button"
                        onClick={() => setPlayers(ps => ps.filter(x => x.key !== p.key))}
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        Remove
                      </button>
                    </div>

                    {nonMembersAllowed && (
                      <div className="flex gap-1 p-1 rounded-lg bg-gray-100">
                        {(['member', 'non_member'] as PlayerKind[]).map(k => (
                          <button
                            key={k}
                            type="button"
                            onClick={() => updatePlayer(p.key, { ...newPlayer(), key: p.key, paidBy: p.paidBy, kind: k })}
                            className={`flex-1 py-1.5 text-xs font-semibold rounded-md ${p.kind === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
                          >
                            {k === 'member' ? 'Member' : 'Non-member'}
                          </button>
                        ))}
                      </div>
                    )}

                    {p.kind === 'member' ? (
                      <Select
                        value={p.memberId}
                        onChange={v => updatePlayer(p.key, { memberId: v })}
                        options={memberOptions.filter(o => o.value === p.memberId || !players.some(x => x.memberId === o.value))}
                        placeholder="Choose a member"
                        searchPlaceholder="Search members…"
                        className="w-full"
                        triggerClassName={trigger}
                      />
                    ) : (
                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <input className={input} placeholder="First name (optional)" value={p.firstName} maxLength={100} onChange={e => updatePlayer(p.key, { firstName: e.target.value })} />
                          <input className={input} placeholder="Last name (optional)" value={p.lastName} maxLength={100} onChange={e => updatePlayer(p.key, { lastName: e.target.value })} />
                        </div>
                        <input className={input} type="tel" placeholder="Phone number (required)" value={p.mobile} onChange={e => updatePlayer(p.key, { mobile: e.target.value })} />
                        <input className={input} type="email" placeholder="Email (required)" value={p.email} onChange={e => updatePlayer(p.key, { email: e.target.value })} />
                      </div>
                    )}

                    {/* Who pays — required, no default. */}
                    <div>
                      <p className="text-[11px] font-semibold text-gray-500 mb-1">
                        Who pays for this player? <span className={p.paidBy ? 'text-gray-400' : 'text-red-500'}>(required)</span>
                      </p>
                      <div className="flex gap-1 p-1 rounded-lg bg-gray-100" role="radiogroup" aria-label="Who pays for this player">
                        {PAID_BY_OPTIONS.map(o => (
                          <button
                            key={o.value}
                            type="button"
                            role="radio"
                            aria-checked={p.paidBy === o.value}
                            onClick={() => updatePlayer(p.key, { paidBy: o.value })}
                            className={`flex-1 py-1.5 text-xs font-semibold rounded-md ${p.paidBy === o.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
                          >
                            {/* Said from the booking member's side, as they'd say it. */}
                            {o.value === 'booker' ? 'Member pays' : o.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {err && <p className="text-[11px] text-gray-400">{err}</p>}
                  </div>
                )
              })}

              {pickedTwice && <p className="text-xs text-red-600">The same member is added twice.</p>}

              {players.length < maxAdditional && (
                <button
                  type="button"
                  onClick={() => setPlayers(ps => [...ps, newPlayer()])}
                  className="w-full py-2.5 rounded-xl border-2 border-dashed border-gray-200 text-sm font-medium text-gray-500 hover:bg-gray-50"
                >
                  + Add a player
                </button>
              )}
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="px-5 py-4 border-t border-gray-100">
          <button
            type="button"
            onClick={submit}
            disabled={!ready || submitting}
            className="w-full py-3 rounded-xl bg-green-900 text-white font-semibold hover:bg-green-800 disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Booking…' : `Book${players.length ? ` · ${1 + players.length} players` : ''}`}
          </button>
          <p className="text-[11px] text-gray-400 text-center mt-2">
            The member is notified, and any added players get an invitation.
          </p>
        </div>
      </div>
    </div>
  )
}
