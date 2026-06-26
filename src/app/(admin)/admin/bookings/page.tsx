'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { AdminPageHeader, StatCard } from '@/components/admin/AdminUI'
import { format, startOfMonth, endOfMonth, subMonths, isToday } from 'date-fns'
import { formatTeeTime } from '@/lib/utils'
import { GOLF_ROUND_DURATION_MINUTES } from '@/lib/constants'

type BookingStatus = 'tentative' | 'availability_confirmed' | 'payment_confirmed' | 'confirmed' | 'pending' | 'cancelled' | 'waitlist' | 'awaiting_approval'

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
  course?: { name: string; id?: string } | null
  course_id?: string
}

const STATUS_META: Record<BookingStatus, { label: string; colour: string; dot: string }> = {
  awaiting_approval:     { label: 'Awaiting approval', colour: 'bg-orange-50 text-orange-700', dot: 'bg-orange-400' },
  tentative:             { label: 'Tentative',         colour: 'bg-yellow-50 text-yellow-700', dot: 'bg-yellow-400' },
  availability_confirmed:{ label: 'Avail. confirmed',  colour: 'bg-blue-50 text-blue-700',    dot: 'bg-blue-400'   },
  payment_confirmed:     { label: 'Payment confirmed', colour: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  confirmed:             { label: 'Confirmed',         colour: 'bg-green-50 text-green-700',  dot: 'bg-green-500'  },
  pending:               { label: 'Pending',           colour: 'bg-yellow-50 text-yellow-700', dot: 'bg-yellow-400' },
  cancelled:             { label: 'Cancelled',         colour: 'bg-gray-100 text-gray-400',   dot: 'bg-gray-300'   },
  waitlist:              { label: 'Waitlist',          colour: 'bg-gray-100 text-gray-400',   dot: 'bg-gray-300'   },
}

const ALL_STATUSES = Object.keys(STATUS_META) as BookingStatus[]
const STATUS_FILTERS = ['all', 'tentative', 'awaiting_approval', 'availability_confirmed', 'payment_confirmed', 'confirmed', 'cancelled'] as const
type StatusFilter = typeof STATUS_FILTERS[number]

type TeeSlot = { key: string; booking_date: string; tee_time: string; rows: BookingRow[] }
type DateGroup = { date: string; label: string; isToday: boolean; slots: TeeSlot[] }

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
    .sort((a, b) => a.key.localeCompare(b.key))
}

function groupByDate(slots: TeeSlot[]): DateGroup[] {
  const map = new Map<string, TeeSlot[]>()
  for (const slot of slots) {
    const arr = map.get(slot.booking_date) ?? []
    arr.push(slot)
    map.set(slot.booking_date, arr)
  }
  return [...map.entries()]
    .map(([date, s]) => ({
      date,
      label: format(new Date(`${date}T12:00:00`), 'EEEE, MMMM d, yyyy'),
      isToday: isToday(new Date(`${date}T12:00:00`)),
      slots: s,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

function playerInfo(b: BookingRow): { name: string; sub: string; badge?: string } {
  if (b.guest_name) return { name: b.guest_name, sub: 'Non-member guest', badge: 'Guest' }
  if (b.player) return { name: `${b.player.first_name ?? ''} ${b.player.last_name ?? ''}`.trim(), sub: b.player.email ?? '', badge: 'Invited' }
  return { name: `${b.member?.first_name ?? ''} ${b.member?.last_name ?? ''}`.trim(), sub: b.member?.email ?? '' }
}

function slotEndTime(teeTime: string): string {
  const [th = 0, tm = 0] = teeTime.split(':').map(Number)
  const endMins = th * 60 + tm + GOLF_ROUND_DURATION_MINUTES
  return formatTeeTime(`${String(Math.floor(endMins / 60)).padStart(2, '0')}:${String(endMins % 60).padStart(2, '0')}:00`)
}

// ---- Slot card (collapsible) ----------------------------------------

function SlotCard({
  slot,
  showCourseName,
  expandedSlots,
  onToggle,
  updatingStatus,
  onUpdateStatus,
  editingNote,
  noteValues,
  onEditNote,
  onNoteChange,
  onSaveNote,
  savingNote,
  noteRef,
}: {
  slot: TeeSlot
  showCourseName: boolean
  expandedSlots: Set<string>
  onToggle: (key: string) => void
  updatingStatus: string | null
  onUpdateStatus: (id: string, status: BookingStatus) => void
  editingNote: string | null
  noteValues: Record<string, string>
  onEditNote: (id: string | null) => void
  onNoteChange: (id: string, val: string) => void
  onSaveNote: (id: string) => void
  savingNote: string | null
  noteRef: React.RefObject<HTMLTextAreaElement>
}) {
  const isExpanded = expandedSlots.has(slot.key)
  const totalAmount = slot.rows.reduce((sum, b) => sum + Number(b.amount_charged), 0)

  // Status breakdown for the slot header
  const statusBreakdown = slot.rows.reduce<Record<string, number>>((acc, b) => {
    acc[b.status] = (acc[b.status] ?? 0) + 1
    return acc
  }, {})
  const hasAttention = slot.rows.some(b => ['awaiting_approval', 'tentative'].includes(b.status))

  return (
    <div className="bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm">
      {/* Slot header — always visible, clickable to toggle */}
      <button
        type="button"
        className="w-full px-5 py-3 text-left flex items-center justify-between gap-3 hover:bg-gray-50 transition-colors"
        onClick={() => onToggle(slot.key)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <svg
            className={`w-3.5 h-3.5 flex-shrink-0 text-gray-400 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-semibold text-gray-800">
                {formatTeeTime(slot.tee_time)} – {slotEndTime(slot.tee_time)}
              </p>
              {showCourseName && slot.rows[0]?.course?.name && (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-purple-50 text-purple-700">
                  {slot.rows[0].course.name}
                </span>
              )}
              {hasAttention && (
                <span className="w-1.5 h-1.5 rounded-full bg-orange-400 flex-shrink-0" title="Needs attention" />
              )}
            </div>
            {/* Status dots */}
            <div className="flex items-center gap-1.5 mt-1">
              {Object.entries(statusBreakdown).map(([status, count]) => {
                const meta = STATUS_META[status as BookingStatus]
                return (
                  <span key={status} className={`flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${meta.colour}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                    {count} {meta.label}
                  </span>
                )
              })}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4 flex-shrink-0">
          <div className="text-right">
            <p className="text-xs font-semibold text-green-700">${totalAmount.toFixed(0)}</p>
            <p className="text-[10px] text-gray-400">{slot.rows.length} player{slot.rows.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
      </button>

      {/* Expanded: per-player rows */}
      {isExpanded && (
        <div className="divide-y divide-gray-50 border-t border-gray-100">
          {slot.rows.map(b => {
            const info = playerInfo(b)
            const sm = STATUS_META[b.status] ?? STATUS_META.tentative
            return (
              <div key={b.id} className="px-5 py-4 flex items-start gap-4">
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

                  {editingNote === b.id ? (
                    <div className="mt-2 flex flex-col gap-1.5" onClick={e => e.stopPropagation()} role="presentation">
                      <textarea
                        ref={noteRef}
                        rows={2}
                        value={noteValues[b.id] ?? ''}
                        onChange={e => onNoteChange(b.id, e.target.value)}
                        className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 resize-none focus:outline-none focus:ring-2 focus:ring-green-900/20"
                      />
                      <div className="flex gap-1.5">
                        <button onClick={() => onSaveNote(b.id)} disabled={savingNote === b.id}
                          className="text-xs px-2.5 py-1 rounded-lg bg-green-900 text-white disabled:opacity-50">
                          {savingNote === b.id ? 'Saving…' : 'Save'}
                        </button>
                        <button onClick={() => onEditNote(null)} className="text-xs px-2.5 py-1 rounded-lg bg-gray-100 text-gray-600">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => onEditNote(b.id)}
                      className="mt-1.5 text-xs text-left text-gray-400 hover:text-gray-600 transition-colors italic">
                      {b.admin_notes ?? 'Add note…'}
                    </button>
                  )}
                </div>

                <div className="flex flex-col items-end gap-2 flex-shrink-0 pt-0.5">
                  <select
                    value={b.status}
                    disabled={updatingStatus === b.id}
                    onChange={e => onUpdateStatus(b.id, e.target.value as BookingStatus)}
                    className={`text-xs font-semibold rounded-lg px-2.5 py-1 border border-transparent outline-none cursor-pointer disabled:opacity-50 transition-colors ${sm.colour}`}
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
      )}
    </div>
  )
}

// ---- Main page -------------------------------------------------------

export default function AdminBookingsPage() {
  const searchParams = useSearchParams()
  const urlCourseId = searchParams.get('courseId') ?? 'all'

  const [bookings, setBookings] = useState<BookingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [month, setMonth] = useState(new Date())
  const [courseList, setCourseList] = useState<{ id: string; name: string }[]>([])
  const [courseFilter, setCourseFilter] = useState<string>(urlCourseId)

  // Sync URL → filter when navigating from the nav
  useEffect(() => { setCourseFilter(urlCourseId) }, [urlCourseId])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null)
  const [editingNote, setEditingNote] = useState<string | null>(null)
  const [noteValues, setNoteValues] = useState<Record<string, string>>({})
  const [savingNote, setSavingNote] = useState<string | null>(null)
  const [expandedSlots, setExpandedSlots] = useState<Set<string>>(new Set())
  const noteRef = useRef<HTMLTextAreaElement>(null)

  const loadBookings = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const monthStart = format(startOfMonth(month), 'yyyy-MM-dd')
    const monthEnd   = format(endOfMonth(month),   'yyyy-MM-dd')

    const { data: courses } = await supabase
      .from('courses')
      .select('id, name')
      .eq('active', true)
      .eq('approval_status', 'active')
      .order('name')

    const courseIds = (courses ?? []).map(c => c.id)
    setCourseList(courses ?? [])

    if (courseIds.length === 0) { setBookings([]); setLoading(false); return }

    let { data, error } = await supabase
      .from('bookings')
      .select('id, booking_date, tee_time, players, guest_name, player_member_id, status, amount_charged, dinner_rsvp, admin_notes, ghl_opportunity_id, course_id, member:members!bookings_member_id_fkey(first_name, last_name, email), course:courses!bookings_course_id_fkey(name)')
      .in('course_id', courseFilter === 'all' ? courseIds : [courseFilter])
      .gte('booking_date', monthStart)
      .lte('booking_date', monthEnd)
      .order('booking_date', { ascending: true })
      .order('tee_time',     { ascending: true })

    // Fallback without dinner_rsvp if column doesn't exist yet
    if (error?.message?.includes('dinner_rsvp')) {
      const fallback = await supabase
        .from('bookings')
        .select('id, booking_date, tee_time, players, guest_name, player_member_id, status, amount_charged, admin_notes, ghl_opportunity_id, course_id, member:members!bookings_member_id_fkey(first_name, last_name, email), course:courses!bookings_course_id_fkey(name)')
        .in('course_id', courseFilter === 'all' ? courseIds : [courseFilter])
        .gte('booking_date', monthStart)
        .lte('booking_date', monthEnd)
        .order('booking_date', { ascending: true })
        .order('tee_time',     { ascending: true })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data = fallback.data as any
      error = fallback.error
    }

    if (error) { console.error('[admin/bookings]', error.message); setLoading(false); return }

    const rows = (data ?? []) as unknown as BookingRow[]

    const playerIds = [...new Set(rows.filter(b => b.player_member_id).map(b => b.player_member_id!))]
    const playerMap = new Map<string, { id: string; first_name: string; last_name: string; email: string }>()
    if (playerIds.length > 0) {
      const { data: players } = await supabase.from('members').select('id, first_name, last_name, email').in('id', playerIds)
      players?.forEach(m => playerMap.set(m.id, m))
    }

    const enriched = rows.map(b => ({ ...b, player: b.player_member_id ? (playerMap.get(b.player_member_id) ?? null) : null }))
    setBookings(enriched)
    const initial: Record<string, string> = {}
    enriched.forEach(b => { initial[b.id] = b.admin_notes ?? '' })
    setNoteValues(initial)
    setExpandedSlots(new Set()) // collapse all on fresh load
    setLoading(false)
  }, [month, courseFilter])

  useEffect(() => { loadBookings() }, [loadBookings])
  useEffect(() => { if (editingNote && noteRef.current) noteRef.current.focus() }, [editingNote])

  const filtered = useMemo(() => bookings.filter(b => {
    const info = playerInfo(b)
    const q = search.toLowerCase()
    const matchesSearch = !search || info.name.toLowerCase().includes(q) || info.sub.toLowerCase().includes(q)
    const matchesStatus = statusFilter === 'all' || b.status === (statusFilter as BookingStatus)
    return matchesSearch && matchesStatus
  }), [bookings, search, statusFilter])

  // Per-course slot grouping for the "All Courses" view
  const byCourse = useMemo(() => {
    if (courseFilter !== 'all' || courseList.length <= 1) return null
    const map = new Map<string, BookingRow[]>()
    for (const b of filtered) {
      const cid = b.course_id ?? 'unknown'
      const arr = map.get(cid) ?? []
      arr.push(b)
      map.set(cid, arr)
    }
    return courseList
      .filter(c => map.has(c.id))
      .map(c => ({ course: c, bookings: map.get(c.id) ?? [] }))
  }, [filtered, courseFilter, courseList])

  const allSlots = useMemo(() => groupBySlot(filtered), [filtered])

  // Stats
  const confirmed  = bookings.filter(b => ['confirmed', 'payment_confirmed', 'availability_confirmed'].includes(b.status)).length
  const tentative  = bookings.filter(b => ['tentative', 'awaiting_approval'].includes(b.status)).length
  const revenue    = bookings.filter(b => ['confirmed', 'payment_confirmed'].includes(b.status)).reduce((s, b) => s + Number(b.amount_charged), 0)
  const attention  = bookings.filter(b => b.status === 'awaiting_approval').length

  async function updateStatus(bookingId: string, status: BookingStatus) {
    setUpdatingStatus(bookingId)
    await fetch(`/api/admin/bookings/${bookingId}/status`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, status } : b))
    setUpdatingStatus(null)
  }

  async function saveNote(bookingId: string) {
    setSavingNote(bookingId)
    await fetch(`/api/admin/bookings/${bookingId}/notes`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ admin_notes: noteValues[bookingId] ?? '' }),
    })
    setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, admin_notes: noteValues[bookingId] || null } : b))
    setSavingNote(null)
    setEditingNote(null)
  }

  function toggleSlot(key: string) {
    setExpandedSlots(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  function expandAll() {
    setExpandedSlots(new Set(allSlots.map(s => s.key)))
  }

  function collapseAll() {
    setExpandedSlots(new Set())
  }

  function exportCSV() {
    const headers = ['Course', 'Player', 'Email', 'Type', 'Date', 'Tee Time', 'Status', 'Dinner RSVP', 'Admin Notes']
    const rows = filtered.map(b => {
      const info = playerInfo(b)
      return [b.course?.name ?? '', info.name, info.sub, info.badge ?? 'Booker', b.booking_date, b.tee_time, b.status, b.dinner_rsvp ?? '', b.admin_notes ?? '']
    })
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url; a.download = `bookings-${format(month, 'yyyy-MM')}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const slotProps = {
    expandedSlots, onToggle: toggleSlot,
    updatingStatus, onUpdateStatus: updateStatus,
    editingNote, noteValues,
    onEditNote: setEditingNote,
    onNoteChange: (id: string, val: string) => setNoteValues(prev => ({ ...prev, [id]: val })),
    onSaveNote: saveNote, savingNote, noteRef,
  }

  // ---- Render ---------------------------------------------------------
  return (
    <div className="p-4 sm:p-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
        <AdminPageHeader
          title={courseFilter === 'all'
            ? 'All Bookings'
            : (courseList.find(c => c.id === courseFilter)?.name ?? 'Bookings')}
          description={courseFilter === 'all'
            ? `${format(month, 'MMMM yyyy')} · ${courseList.length} active course${courseList.length !== 1 ? 's' : ''}`
            : format(month, 'MMMM yyyy')}
        />
        <div className="flex items-center gap-2">
          <button onClick={() => setMonth(m => subMonths(m, 1))} className="px-3 py-1.5 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50">←</button>
          <span className="text-sm font-medium text-gray-700 w-32 text-center">{format(month, 'MMMM yyyy')}</span>
          <button onClick={() => setMonth(m => { const n = new Date(m); n.setMonth(m.getMonth() + 1); return n })}
            disabled={month >= new Date()}
            className="px-3 py-1.5 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40">→</button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard label="Active bookings"   value={confirmed} sub="Confirmed or avail. confirmed" colour="green" />
        <StatCard label="Pending"           value={tentative} sub="Tentative or awaiting approval" colour="blue" />
        <StatCard label="Revenue"           value={`$${revenue.toLocaleString()}`} sub="Confirmed + payment confirmed" colour="green" />
        <StatCard label="Needs attention"   value={attention} sub="Awaiting admin approval" colour={attention > 0 ? 'red' : 'gray'} />
      </div>

      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-5">
        <input
          type="text" placeholder="Search player name or email…" value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full sm:flex-1 sm:max-w-xs px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-900/20"
        />
        <div className="flex gap-1.5 flex-wrap">
          {STATUS_FILTERS.map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${statusFilter === s ? 'bg-green-900 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              {s === 'all' ? 'All' : (STATUS_META[s as BookingStatus]?.label ?? s)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 sm:ml-auto">
          {allSlots.length > 0 && (
            <>
              <button onClick={expandAll} className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1">Expand all</button>
              <button onClick={collapseAll} className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1">Collapse</button>
            </>
          )}
          <button onClick={exportCSV} disabled={filtered.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-colors">
            ↓ CSV
          </button>
        </div>
      </div>

      {/* Bookings */}
      {loading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-3xl mb-3">📅</p>
          <p className="text-sm font-semibold text-gray-600">No bookings match</p>
          <p className="text-xs text-gray-400 mt-1">Try adjusting the filters or changing the month.</p>
        </div>
      ) : byCourse ? (
        /* All-courses view: grouped by course → date → slot */
        <div className="space-y-8">
          {byCourse.map(({ course, bookings: cb }) => {
            const courseSlots = groupBySlot(cb)
            const dateGroups = groupByDate(courseSlots)
            const courseRevenue = cb.filter(b => ['confirmed', 'payment_confirmed'].includes(b.status)).reduce((s, b) => s + Number(b.amount_charged), 0)
            const courseAttention = cb.filter(b => b.status === 'awaiting_approval').length

            return (
              <div key={course.id}>
                {/* Course section header */}
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-px flex-1 bg-gray-100" />
                  <div className="flex items-center gap-3">
                    <h2 className="text-sm font-bold text-gray-700">⛳ {course.name}</h2>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                      {cb.filter(b => b.status !== 'cancelled').length} active
                    </span>
                    {courseRevenue > 0 && (
                      <span className="text-[10px] font-semibold text-green-700">${courseRevenue.toLocaleString()}</span>
                    )}
                    {courseAttention > 0 && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-orange-50 text-orange-600">
                        {courseAttention} need attention
                      </span>
                    )}
                  </div>
                  <div className="h-px flex-1 bg-gray-100" />
                </div>

                <DateGroupedSlots dateGroups={dateGroups} showCourseName={false} slotProps={slotProps} />
              </div>
            )
          })}
        </div>
      ) : (
        /* Single course / filtered view: grouped by date → slot */
        <DateGroupedSlots dateGroups={groupByDate(allSlots)} showCourseName={courseList.length > 1} slotProps={slotProps} />
      )}

      {!loading && filtered.length > 0 && (
        <p className="text-xs text-gray-400 mt-5 text-right">
          {filtered.length} player{filtered.length !== 1 ? 's' : ''} · {allSlots.length} tee slot{allSlots.length !== 1 ? 's' : ''} · {format(month, 'MMMM yyyy')}
        </p>
      )}
    </div>
  )
}

// ---- Date-grouped slot list ------------------------------------------

function DateGroupedSlots({
  dateGroups,
  showCourseName,
  slotProps,
}: {
  dateGroups: DateGroup[]
  showCourseName: boolean
  slotProps: Omit<Parameters<typeof SlotCard>[0], 'slot' | 'showCourseName'>
}) {
  const today = format(new Date(), 'yyyy-MM-dd')
  const past = dateGroups.filter(g => g.date < today)
  const upcoming = dateGroups.filter(g => g.date >= today)

  function Section({ groups, label }: { groups: DateGroup[]; label?: string }) {
    if (groups.length === 0) return null
    return (
      <div>
        {label && (
          <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-3">{label}</p>
        )}
        <div className="space-y-4">
          {groups.map(dg => (
            <div key={dg.date}>
              {/* Date header */}
              <div className="flex items-center gap-2 mb-2">
                <div
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full"
                  style={dg.isToday
                    ? { background: 'var(--color-green-900)', color: 'white' }
                    : { background: 'rgba(0,38,105,0.05)', color: 'rgba(0,38,105,0.6)' }
                  }
                >
                  {dg.isToday && <span className="w-1.5 h-1.5 rounded-full bg-green-400" />}
                  {dg.label}
                  {dg.isToday && <span className="ml-0.5 font-bold">— Today</span>}
                </div>
                <div className="h-px flex-1 bg-gray-100" />
                <span className="text-[10px] text-gray-400">
                  {dg.slots.reduce((s, sl) => s + sl.rows.length, 0)} player{dg.slots.reduce((s, sl) => s + sl.rows.length, 0) !== 1 ? 's' : ''}
                </span>
              </div>

              {/* Slots for this date */}
              <div className="space-y-2 pl-1">
                {dg.slots.map(slot => (
                  <SlotCard key={slot.key} slot={slot} showCourseName={showCourseName} {...slotProps} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <Section groups={upcoming} label={past.length > 0 ? 'Upcoming' : undefined} />
      {past.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs font-medium text-gray-400 hover:text-gray-600 select-none flex items-center gap-2">
            <span>Past bookings ({past.reduce((s, g) => s + g.slots.reduce((ss, sl) => ss + sl.rows.length, 0), 0)} players)</span>
          </summary>
          <div className="mt-4">
            <Section groups={past} />
          </div>
        </details>
      )}
    </div>
  )
}
