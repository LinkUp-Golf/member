'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { COURSE_SLUGS } from '@/lib/ghl/tags'
import { AdminPageHeader, StatCard, AdminCard, ProgressBar } from '@/components/admin/AdminUI'
import { format, startOfMonth, endOfMonth, subMonths, addMinutes } from 'date-fns'
import { bookingToLocalDate } from '@/lib/utils'
import { GOLF_ROUND_DURATION_MINUTES } from '@/lib/constants'

type BookingStatus = 'tentative' | 'availability_confirmed' | 'payment_confirmed' | 'confirmed' | 'pending' | 'cancelled' | 'waitlist'

interface BookingRow {
  id: string
  booking_date: string
  tee_time: string
  players: number
  guest_name: string | null
  player_member_id: string | null
  status: BookingStatus
  amount_charged: number
  dinner_rsvp: 'yes' | 'no' | 'maybe' | null
  admin_notes: string | null
  ghl_opportunity_id: string | null
  member: { first_name: string; last_name: string; email: string } | null
  player?: { id: string; first_name: string; last_name: string; email: string } | null
}

const STATUS_META: Record<BookingStatus, { label: string; bg: string; text: string }> = {
  tentative:              { label: 'Tentative',          bg: 'bg-yellow-50',  text: 'text-yellow-700' },
  availability_confirmed: { label: 'Avail. Confirmed',   bg: 'bg-blue-50',    text: 'text-blue-700'   },
  payment_confirmed:      { label: 'Payment Confirmed',  bg: 'bg-emerald-50', text: 'text-emerald-700' },
  confirmed:              { label: 'Confirmed',          bg: 'bg-green-50',   text: 'text-green-700'  },
  pending:                { label: 'Pending',            bg: 'bg-yellow-50',  text: 'text-yellow-700' },
  cancelled:              { label: 'Cancelled',          bg: 'bg-gray-100',   text: 'text-gray-400'   },
  waitlist:               { label: 'Waitlist',           bg: 'bg-gray-100',   text: 'text-gray-400'   },
}

const ALL_STATUSES = Object.keys(STATUS_META) as BookingStatus[]
const STATUS_FILTERS = ['all', 'tentative', 'availability_confirmed', 'payment_confirmed', 'confirmed', 'cancelled'] as const
type StatusFilter = typeof STATUS_FILTERS[number]

type TeeSlot = { key: string; booking_date: string; tee_time: string; rows: BookingRow[] }

function groupBySlot(bookings: BookingRow[]): TeeSlot[] {
  const map = new Map<string, BookingRow[]>()
  for (const b of bookings) {
    const key = `${b.booking_date}_${b.tee_time}`
    const arr = map.get(key) ?? []
    arr.push(b)
    map.set(key, arr)
  }
  return [...map.entries()]
    .map(([key, rows]) => ({ key, booking_date: rows[0]!.booking_date, tee_time: rows[0]!.tee_time, rows }))
    .sort((a, b) => b.key.localeCompare(a.key))
}

function playerInfo(b: BookingRow): { name: string; sub: string; badge?: string } {
  if (b.guest_name) return { name: b.guest_name, sub: 'Non-member guest', badge: 'Guest' }
  if (b.player) return { name: `${b.player.first_name ?? ''} ${b.player.last_name ?? ''}`.trim(), sub: b.player.email ?? '', badge: 'Invited' }
  return { name: `${b.member?.first_name ?? ''} ${b.member?.last_name ?? ''}`.trim(), sub: b.member?.email ?? '' }
}

export default function AdminBookingsPage() {
  const [bookings, setBookings] = useState<BookingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [month, setMonth] = useState(new Date())
  const [courseData, setCourseData] = useState<{ max_rounds_per_month: number; reserved_rounds: number } | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null)
  const [editingNote, setEditingNote] = useState<string | null>(null)
  const [noteValues, setNoteValues] = useState<Record<string, string>>({})
  const [savingNote, setSavingNote] = useState<string | null>(null)
  const noteRef = useRef<HTMLTextAreaElement>(null)

  const loadBookings = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const monthStart = format(startOfMonth(month), 'yyyy-MM-dd')
    const monthEnd = format(endOfMonth(month), 'yyyy-MM-dd')

    const { data: courses, error: coursesError } = await supabase
      .from('courses')
      .select('id, max_rounds_per_month, reserved_rounds')
      .in('slug', COURSE_SLUGS)
    if (coursesError) console.error('[admin/bookings] courses:', coursesError.message)

    const courseIds = (courses ?? []).map(c => c.id)
    setCourseData(courses?.length ? {
      max_rounds_per_month: courses.reduce((sum, c) => sum + c.max_rounds_per_month, 0),
      reserved_rounds: courses.reduce((sum, c) => sum + c.reserved_rounds, 0),
    } : null)

    if (courseIds.length === 0) {
      console.warn('[admin/bookings] no courses matched COURSE_SLUGS:', COURSE_SLUGS)
      setBookings([])
      setLoading(false)
      return
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let { data, error } = await supabase
      .from('bookings')
      .select('id, booking_date, tee_time, players, guest_name, player_member_id, status, amount_charged, dinner_rsvp, admin_notes, ghl_opportunity_id, member:members!bookings_member_id_fkey(first_name, last_name, email)')
      .in('course_id', courseIds)
      .gte('booking_date', monthStart)
      .lte('booking_date', monthEnd)
      .order('booking_date', { ascending: false })

    if (error?.message?.includes('dinner_rsvp')) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fallback = await supabase
        .from('bookings')
        .select('id, booking_date, tee_time, players, guest_name, player_member_id, status, amount_charged, admin_notes, ghl_opportunity_id, member:members!bookings_member_id_fkey(first_name, last_name, email)')
        .in('course_id', courseIds)
        .gte('booking_date', monthStart)
        .lte('booking_date', monthEnd)
        .order('booking_date', { ascending: false })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data = fallback.data as any
      error = fallback.error
    }

    if (error) { console.error('[admin/bookings]', error.message); setLoading(false); return }

    const rows = (data ?? []) as unknown as BookingRow[]

    // Fetch invited member details for rows with player_member_id
    const playerIds = [...new Set(rows.filter(b => b.player_member_id).map(b => b.player_member_id!))]
    const playerMap = new Map<string, { id: string; first_name: string; last_name: string; email: string }>()
    if (playerIds.length > 0) {
      const { data: players } = await supabase
        .from('members')
        .select('id, first_name, last_name, email')
        .in('id', playerIds)
      players?.forEach(m => playerMap.set(m.id, m))
    }

    const enriched: BookingRow[] = (rows as unknown as BookingRow[]).map(b => ({
      ...b,
      player: b.player_member_id ? (playerMap.get(b.player_member_id) ?? null) : null,
    }))

    setBookings(enriched)
    const initial: Record<string, string> = {}
    enriched.forEach(b => { initial[b.id] = b.admin_notes ?? '' })
    setNoteValues(initial)
    setLoading(false)
  }, [month])

  useEffect(() => { loadBookings() }, [month, loadBookings])
  useEffect(() => { if (editingNote && noteRef.current) noteRef.current.focus() }, [editingNote])

  const filtered = useMemo(() => bookings.filter(b => {
    const info = playerInfo(b)
    const q = search.toLowerCase()
    const matchesSearch = !search ||
      info.name.toLowerCase().includes(q) ||
      info.sub.toLowerCase().includes(q)
    const matchesStatus = statusFilter === 'all' || b.status === (statusFilter as BookingStatus)
    return matchesSearch && matchesStatus
  }), [bookings, search, statusFilter])

  const slots = useMemo(() => groupBySlot(filtered), [filtered])

  const confirmed = bookings.filter(b => ['confirmed', 'payment_confirmed', 'availability_confirmed'].includes(b.status)).length
  const tentative = bookings.filter(b => b.status === 'tentative').length
  const revenue = bookings.filter(b => ['confirmed', 'payment_confirmed'].includes(b.status)).reduce((sum, b) => sum + Number(b.amount_charged), 0)
  const memberAlloc = courseData ? courseData.max_rounds_per_month - courseData.reserved_rounds : 200

  async function updateStatus(bookingId: string, status: BookingStatus) {
    setUpdatingStatus(bookingId)
    await fetch(`/api/admin/bookings/${bookingId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, status } : b))
    setUpdatingStatus(null)
  }

  async function saveNote(bookingId: string) {
    setSavingNote(bookingId)
    await fetch(`/api/admin/bookings/${bookingId}/notes`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ admin_notes: noteValues[bookingId] ?? '' }),
    })
    setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, admin_notes: noteValues[bookingId] || null } : b))
    setSavingNote(null)
    setEditingNote(null)
  }

  function exportCSV() {
    const headers = ['Player', 'Email', 'Type', 'Date', 'Tee Time', 'Status', 'Dinner RSVP', 'Admin Notes']
    const rows = filtered.map(b => {
      const info = playerInfo(b)
      return [info.name, info.sub, info.badge ?? 'Booker', b.booking_date, b.tee_time, b.status, b.dinner_rsvp ?? '', b.admin_notes ?? '']
    })
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url; a.download = `bookings-${format(month, 'yyyy-MM')}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const nextMonth = () => setMonth(m => { const n = new Date(m); n.setMonth(m.getMonth() + 1); return n })
  const prevMonth = () => setMonth(m => subMonths(m, 1))

  return (
    <div className="p-4 sm:p-8">
      <AdminPageHeader
        title="Booking Overview"
        description="Park Hyatt Aviara"
        action={
          <div className="flex items-center gap-2">
            <button onClick={prevMonth} className="px-3 py-1.5 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50">←</button>
            <span className="text-sm font-medium text-gray-700 w-32 text-center">{format(month, 'MMMM yyyy')}</span>
            <button onClick={nextMonth} disabled={month >= new Date()} className="px-3 py-1.5 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40">→</button>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <StatCard label="Confirmed rounds" value={confirmed} sub={`of ${memberAlloc} member allocation`} colour="green" />
        <StatCard label="Tentative" value={tentative} sub="Pending availability check" colour="blue" />
        <StatCard label="Revenue" value={`$${revenue.toLocaleString()}`} sub="Paid bookings" colour="green" />
        <StatCard label="Reserved pool" value={courseData?.reserved_rounds ?? 0} sub="Held for NBD + events" colour="gray" />
      </div>

      <AdminCard title={`Round utilisation — ${format(month, 'MMMM yyyy')}`}>
        <ProgressBar value={confirmed} max={memberAlloc} />
        <div className="grid grid-cols-3 gap-4 mt-4 text-sm">
          <div className="text-center">
            <p className="text-2xl font-bold text-green-700">{confirmed}</p>
            <p className="text-xs text-gray-400">Member rounds booked</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-gray-400">{memberAlloc - confirmed}</p>
            <p className="text-xs text-gray-400">Remaining</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-gray-400">{courseData?.reserved_rounds ?? 0}</p>
            <p className="text-xs text-gray-400">Reserved (NBD + events)</p>
          </div>
        </div>
      </AdminCard>

      {/* Filter bar */}
      <div className="mt-6 mb-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <input
          type="text"
          placeholder="Search player name or email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full sm:flex-1 sm:max-w-xs px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-900/20"
        />
        <div className="flex gap-1.5 flex-wrap">
          {STATUS_FILTERS.map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                statusFilter === s ? 'bg-green-900 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {s === 'all' ? 'All' : (STATUS_META[s as BookingStatus]?.label ?? s)}
            </button>
          ))}
        </div>
        <button
          onClick={exportCSV}
          disabled={filtered.length === 0}
          className="sm:ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-colors"
        >
          ↓ Export CSV
        </button>
      </div>

      {/* Tee-slot cards */}
      {loading ? (
        <p className="text-sm text-gray-400 py-12 text-center">Loading…</p>
      ) : slots.length === 0 ? (
        <p className="text-sm text-gray-400 py-12 text-center">No bookings match the current filters.</p>
      ) : (
        <div className="space-y-3">
          {slots.map(slot => {
            const dt = bookingToLocalDate(slot.booking_date, slot.tee_time)
            const endDt = addMinutes(dt, GOLF_ROUND_DURATION_MINUTES)
            const totalAmount = slot.rows.reduce((sum, b) => sum + Number(b.amount_charged), 0)
            return (
              <div key={slot.key} className="bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm">
                {/* Slot header */}
                <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-gray-800">
                      {format(dt, 'EEE, MMM d')} · {format(dt, 'h:mm a')} – {format(endDt, 'h:mm a')}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {slot.rows.length} player{slot.rows.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <p className="text-sm font-semibold text-green-700">${totalAmount.toFixed(0)}</p>
                </div>

                {/* Per-player rows */}
                <div className="divide-y divide-gray-50">
                  {slot.rows.map(b => {
                    const info = playerInfo(b)
                    const sm = STATUS_META[b.status] ?? STATUS_META.tentative
                    return (
                      <div key={b.id} className="px-5 py-4 flex items-start gap-4">
                        {/* Left: player info + notes */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium text-gray-800">{info.name}</p>
                            {info.badge && (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
                                {info.badge}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-400 mt-0.5 truncate">{info.sub}</p>

                          {/* Notes */}
                          {editingNote === b.id ? (
                            <div className="mt-2 flex flex-col gap-1.5" onClick={e => e.stopPropagation()} role="presentation">
                              <textarea
                                ref={noteRef}
                                rows={2}
                                value={noteValues[b.id] ?? ''}
                                onChange={e => setNoteValues(prev => ({ ...prev, [b.id]: e.target.value }))}
                                className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 resize-none focus:outline-none focus:ring-2 focus:ring-green-900/20"
                              />
                              <div className="flex gap-1.5">
                                <button
                                  onClick={() => saveNote(b.id)}
                                  disabled={savingNote === b.id}
                                  className="text-xs px-2.5 py-1 rounded-lg bg-green-900 text-white disabled:opacity-50"
                                >
                                  {savingNote === b.id ? 'Saving…' : 'Save'}
                                </button>
                                <button
                                  onClick={() => { setEditingNote(null); setNoteValues(prev => ({ ...prev, [b.id]: b.admin_notes ?? '' })) }}
                                  className="text-xs px-2.5 py-1 rounded-lg bg-gray-100 text-gray-600"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              onClick={() => setEditingNote(b.id)}
                              className="mt-2 text-xs text-left text-gray-400 hover:text-gray-600 transition-colors italic"
                            >
                              {b.admin_notes ?? 'Add note…'}
                            </button>
                          )}
                        </div>

                        {/* Right: status + dinner */}
                        <div className="flex flex-col items-end gap-2 flex-shrink-0 pt-0.5">
                          <select
                            value={b.status}
                            disabled={updatingStatus === b.id}
                            onChange={e => updateStatus(b.id, e.target.value as BookingStatus)}
                            className={`text-xs font-semibold rounded-lg px-2.5 py-1 border border-transparent outline-none cursor-pointer disabled:opacity-50 transition-colors ${sm.bg} ${sm.text}`}
                          >
                            {ALL_STATUSES.map(s => (
                              <option key={s} value={s}>{STATUS_META[s].label}</option>
                            ))}
                          </select>

                          {b.dinner_rsvp ? (
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                              b.dinner_rsvp === 'yes'   ? 'bg-green-50 text-green-600' :
                              b.dinner_rsvp === 'maybe' ? 'bg-yellow-50 text-yellow-600' :
                                                          'bg-gray-100 text-gray-400'
                            }`}>
                              🍽 {b.dinner_rsvp === 'yes' ? 'Yes' : b.dinner_rsvp === 'no' ? 'No' : 'Maybe'}
                            </span>
                          ) : (
                            <span className="text-[10px] text-gray-300">No dinner RSVP</span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <p className="text-xs text-gray-400 mt-4 text-right">
          {filtered.length} player{filtered.length !== 1 ? 's' : ''} across {slots.length} tee slot{slots.length !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  )
}
