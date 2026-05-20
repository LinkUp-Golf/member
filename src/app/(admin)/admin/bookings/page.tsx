'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import {
  AdminPageHeader, StatCard, AdminTable, AdminTr, AdminTd,
  ProgressBar, AdminCard, AdminButton,
} from '@/components/admin/AdminUI'
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns'
import { formatTeeTime } from '@/lib/utils'

type BookingStatus = 'confirmed' | 'pending' | 'cancelled' | 'waitlist'

interface BookingRow {
  id: string
  booking_date: string
  tee_time: string
  players: number
  guest_name: string | null
  status: BookingStatus
  amount_charged: number
  admin_notes: string | null
  member: { first_name: string; last_name: string; email: string } | null
}

const STATUS_FILTERS = ['all', 'confirmed', 'pending', 'cancelled'] as const
type StatusFilter = typeof STATUS_FILTERS[number]

export default function AdminBookingsPage() {
  const [bookings, setBookings] = useState<BookingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [month, setMonth] = useState(new Date())
  const [courseData, setCourseData] = useState<{ max_rounds_per_month: number; reserved_rounds: number } | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [editingNote, setEditingNote] = useState<string | null>(null)
  const [noteValues, setNoteValues] = useState<Record<string, string>>({})
  const [savingNote, setSavingNote] = useState<string | null>(null)
  const noteRef = useRef<HTMLTextAreaElement>(null)

  const loadBookings = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const monthStart = format(startOfMonth(month), 'yyyy-MM-dd')
    const monthEnd = format(endOfMonth(month), 'yyyy-MM-dd')

    const { data: course } = await supabase
      .from('courses')
      .select('id, max_rounds_per_month, reserved_rounds')
      .eq('slug', 'aviara')
      .single()

    setCourseData(course)

    const { data } = await supabase
      .from('bookings')
      .select('id, booking_date, tee_time, players, guest_name, status, amount_charged, admin_notes, member:members(first_name, last_name, email)')
      .eq('course_id', course?.id)
      .gte('booking_date', monthStart)
      .lte('booking_date', monthEnd)
      .order('booking_date', { ascending: false })

    const rows = (data ?? []) as unknown as BookingRow[]
    setBookings(rows)
    const initial: Record<string, string> = {}
    rows.forEach(b => { initial[b.id] = b.admin_notes ?? '' })
    setNoteValues(initial)
    setLoading(false)
  }, [month])

  useEffect(() => { loadBookings() }, [month, loadBookings])

  useEffect(() => {
    if (editingNote && noteRef.current) noteRef.current.focus()
  }, [editingNote])

  const filtered = useMemo(() => {
    return bookings.filter(b => {
      const memberName = `${b.member?.first_name ?? ''} ${b.member?.last_name ?? ''} ${b.member?.email ?? ''}`.toLowerCase()
      const matchesSearch = !search || memberName.includes(search.toLowerCase())
      const matchesStatus = statusFilter === 'all' || b.status === statusFilter
      return matchesSearch && matchesStatus
    })
  }, [bookings, search, statusFilter])

  const confirmed = bookings.filter(b => b.status === 'confirmed').length
  const withGuest = bookings.filter(b => b.guest_name).length
  const revenue = bookings.filter(b => b.status === 'confirmed').reduce((sum, b) => sum + Number(b.amount_charged), 0)
  const memberAlloc = courseData ? courseData.max_rounds_per_month - courseData.reserved_rounds : 200

  async function saveNote(bookingId: string) {
    setSavingNote(bookingId)
    await fetch(`/api/admin/bookings/${bookingId}/notes`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ admin_notes: noteValues[bookingId] ?? '' }),
    })
    setSavingNote(null)
    setEditingNote(null)
    // Update local state to reflect saved note
    setBookings(prev =>
      prev.map(b => b.id === bookingId ? { ...b, admin_notes: noteValues[bookingId] || null } : b)
    )
  }

  function exportCSV() {
    const headers = ['Member', 'Email', 'Date', 'Tee Time', 'Players', 'Guest', 'Amount ($)', 'Status', 'Admin Notes']
    const rows = filtered.map(b => [
      `${b.member?.first_name ?? ''} ${b.member?.last_name ?? ''}`.trim(),
      b.member?.email ?? '',
      b.booking_date,
      b.tee_time,
      b.players,
      b.guest_name ?? '',
      Number(b.amount_charged).toFixed(2),
      b.status,
      b.admin_notes ?? '',
    ])
    const csv = [headers, ...rows]
      .map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `bookings-${format(month, 'yyyy-MM')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const nextMonth = () => setMonth(m => { const n = new Date(m); n.setMonth(m.getMonth() + 1); return n })
  const prevMonth = () => setMonth(m => subMonths(m, 1))

  return (
    <div className="p-4 sm:p-8 max-w-6xl">
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

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <StatCard label="Confirmed rounds" value={confirmed} sub={`of ${memberAlloc} member allocation`} colour="green" />
        <StatCard label="Rounds with guest" value={withGuest} sub="Non-member guests" colour="blue" />
        <StatCard label="Revenue" value={`$${revenue.toLocaleString()}`} sub="Confirmed payments" colour="green" />
        <StatCard label="Reserved pool" value={courseData?.reserved_rounds ?? 0} sub="Held for NBD + events" colour="gray" />
      </div>

      {/* Capacity bar */}
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
          placeholder="Search member name or email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full sm:flex-1 sm:max-w-xs px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-900/20"
        />
        <div className="flex gap-1.5">
          {STATUS_FILTERS.map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                statusFilter === s
                  ? 'bg-green-900 text-white'
                  : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {s}
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

      {/* Booking list */}
      <AdminTable
        headers={['Member', 'Date', 'Tee time', 'Players', 'Guest', 'Amount', 'Status', 'Notes']}
        empty={loading ? 'Loading…' : filtered.length === 0 ? 'No bookings match the current filters.' : undefined}
      >
        {filtered.map(b => (
          <AdminTr key={b.id}>
            <AdminTd>
              <p className="font-medium text-gray-900">{b.member?.first_name} {b.member?.last_name}</p>
              <p className="text-xs text-gray-400">{b.member?.email}</p>
            </AdminTd>
            <AdminTd>{format(new Date(b.booking_date + 'T12:00:00'), 'EEE, MMM d')}</AdminTd>
            <AdminTd>{formatTeeTime(b.tee_time)}</AdminTd>
            <AdminTd>{b.players}</AdminTd>
            <AdminTd>{b.guest_name ?? <span className="text-gray-300">—</span>}</AdminTd>
            <AdminTd className="font-medium text-green-700">${Number(b.amount_charged).toFixed(0)}</AdminTd>
            <AdminTd>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                b.status === 'confirmed' ? 'bg-green-50 text-green-700' :
                b.status === 'pending'   ? 'bg-yellow-50 text-yellow-700' :
                'bg-gray-100 text-gray-500'
              }`}>
                {b.status}
              </span>
            </AdminTd>
            <AdminTd className="max-w-xs">
              {editingNote === b.id ? (
                <div className="flex flex-col gap-1.5" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()} role="presentation">
                  <textarea
                    ref={noteRef}
                    rows={2}
                    value={noteValues[b.id] ?? ''}
                    onChange={e => setNoteValues(prev => ({ ...prev, [b.id]: e.target.value }))}
                    className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 resize-none focus:outline-none focus:ring-2 focus:ring-green-900/20"
                  />
                  <div className="flex gap-1.5">
                    <AdminButton
                      label={savingNote === b.id ? 'Saving…' : 'Save'}
                      onClick={() => saveNote(b.id)}
                      variant="primary"
                      size="sm"
                      disabled={savingNote === b.id}
                    />
                    <AdminButton
                      label="Cancel"
                      onClick={() => {
                        setEditingNote(null)
                        setNoteValues(prev => ({ ...prev, [b.id]: b.admin_notes ?? '' }))
                      }}
                      variant="ghost"
                      size="sm"
                    />
                  </div>
                </div>
              ) : (
                <div
                  className="group flex items-start gap-1 cursor-pointer"
                  role="button"
                  tabIndex={0}
                  onClick={e => { e.stopPropagation(); setEditingNote(b.id) }}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); setEditingNote(b.id) } }}
                >
                  {b.admin_notes ? (
                    <p className="text-xs text-gray-600 leading-snug">{b.admin_notes}</p>
                  ) : (
                    <p className="text-xs text-gray-300 italic">Add note…</p>
                  )}
                  <span className="text-gray-300 opacity-0 group-hover:opacity-100 text-xs ml-auto flex-shrink-0 transition-opacity">✏</span>
                </div>
              )}
            </AdminTd>
          </AdminTr>
        ))}
      </AdminTable>

      {!loading && filtered.length > 0 && (
        <p className="text-xs text-gray-400 mt-3 text-right">
          Showing {filtered.length} of {bookings.length} booking{bookings.length !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  )
}
