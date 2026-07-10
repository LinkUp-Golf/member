'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { AdminPageHeader, StatCard } from '@/components/admin/AdminUI'
import Select from '@/components/ui/Select'
import { format, addDays, subDays, isToday, differenceInCalendarDays } from 'date-fns'
import { formatTeeTime } from '@/lib/utils'
import { GOLF_ROUND_DURATION_MINUTES } from '@/lib/constants'
import type { AdditionalPlayer } from '@/types'

type BookingStatus = 'tentative' | 'availability_confirmed' | 'payment_confirmed' | 'confirmed' | 'pending' | 'cancelled' | 'waitlist' | 'awaiting_approval'

interface BookingRow {
  id: string
  member_id: string
  created_at: string
  booking_date: string
  tee_time: string
  players: number
  guest_name: string | null
  player_member_id: string | null
  additional_players?: AdditionalPlayer[] | null
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

// Statuses an admin can manually move a booking through — the payment pipeline
// only. Other values (cancelled, awaiting_approval, and legacy confirmed /
// pending / waitlist) aren't manual targets. If a row is already in one of
// those, it's still shown as the current (selected) option so the control
// renders correctly, but only these three can be chosen.
const STATUS_ACTIONS: BookingStatus[] = ['tentative', 'availability_confirmed', 'payment_confirmed']
const STATUS_FILTERS =['all', 'tentative', 'awaiting_approval', 'availability_confirmed', 'payment_confirmed', 'confirmed', 'cancelled', 'payment_overdue'] as const
type StatusFilter = typeof STATUS_FILTERS[number]

// Payment Overdue isn't a real booking status — it's availability_confirmed
// (member notified, "Payment due" on their side) rows, i.e. still unpaid.
// The filter matches any such unpaid row regardless of date; the "days left"
// badge on each row (see paymentDaysLeftLabel) shows the countdown to tee time.
const STATUS_FILTER_LABELS: Partial<Record<StatusFilter, string>> = {
  payment_overdue: '⚠ Unpaid — payment not yet received',
}

const DINNER_FILTERS = ['all', 'yes', 'no', 'maybe', 'none'] as const
type DinnerFilter = typeof DINNER_FILTERS[number]
const DINNER_FILTER_LABELS: Record<DinnerFilter, string> = {
  all: 'All', yes: '🍽 Yes', no: '🍽 No', maybe: '🍽 Maybe', none: 'No response',
}

// "Who's Playing" is a 30-day-lookahead preset of the date-range toggle —
// who's actually teeing off soon, without scrolling through the full
// 365-day "Upcoming" window.
const WHOS_PLAYING_WINDOW_DAYS = 30
type BookingsView = 'all' | 'upcoming' | 'past' | 'whos-playing'
const VIEW_LABELS: Record<BookingsView, string> = {
  all: 'All', upcoming: 'Upcoming', past: 'Past', 'whos-playing': "Who's Playing",
}

interface CourseListItem {
  id: string
  name: string
  description: string | null
  city: string
  state: string
  access_tag: string
  required_tags: string[]
}

interface AccessMemberRow {
  id: string
  first_name: string
  last_name: string
  email: string
  ghl_tags: string[]
}

type TeeSlot = { key: string; booking_date: string; tee_time: string; created_at: string; rows: BookingRow[] }
type DateGroup = { date: string; label: string; isToday: boolean; slots: TeeSlot[] }

// Grouped by (booker + tee time + created_at) rather than just date/time —
// two separate booking groups can land on the same tee time by coincidence
// and must not be merged into one slot. Rows inserted together (one
// transaction) share the exact same created_at, since Postgres evaluates
// now() once per statement.
function groupBySlot(bookings: BookingRow[]): TeeSlot[] {
  const map = new Map<string, BookingRow[]>()
  for (const b of bookings) {
    const key = `${b.member_id}_${b.created_at}_${b.booking_date}_${b.tee_time}`
    const arr = map.get(key) ?? []
    arr.push(b)
    map.set(key, arr)
  }
  return [...map.entries()]
    .map(([key, rows]) => {
      const first = rows[0]!
      return { key, booking_date: first.booking_date, tee_time: first.tee_time, created_at: first.created_at, rows }
    })
    .sort((a, b) => a.tee_time.localeCompare(b.tee_time) || a.created_at.localeCompare(b.created_at))
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
  if (b.guest_name) {
    const guest = b.additional_players?.[0]
    const contact = [guest?.email, guest?.mobile].filter(Boolean).join(' · ')
    return { name: b.guest_name, sub: contact || 'Non-member guest', badge: 'Guest' }
  }
  if (b.player) return { name: `${b.player.first_name ?? ''} ${b.player.last_name ?? ''}`.trim(), sub: b.player.email ?? '', badge: 'Invited' }
  return { name: `${b.member?.first_name ?? ''} ${b.member?.last_name ?? ''}`.trim(), sub: b.member?.email ?? '' }
}

// "Days left" badge for any unpaid player row — shown whenever the booking is
// still tentative or availability_confirmed, regardless of how far out the tee
// time is (past-due rows read "Overdue").
function paymentDaysLeftLabel(b: BookingRow): string | null {
  if (b.status !== 'tentative' && b.status !== 'availability_confirmed') return null
  const daysLeft = differenceInCalendarDays(new Date(`${b.booking_date}T12:00:00`), new Date())
  if (daysLeft < 0) return 'Overdue'
  if (daysLeft === 0) return 'Due today'
  if (daysLeft === 1) return '1 day left'
  return `${daysLeft} days left`
}

// Whether a payment reminder can be sent for this row. The GHL webhook matches
// the contact by email: members (booker or invited) always have one from
// signup; a non-member guest is only reachable if an email was captured at
// booking time.
function canRemindPayment(b: BookingRow): boolean {
  if (b.player_member_id) return true
  if (!b.guest_name) return true
  return !!b.additional_players?.[0]?.email
}

function slotEndTime(teeTime: string): string {
  const [th = 0, tm = 0] = teeTime.split(':').map(Number)
  // Wrap into a 24h clock for display — a late tee time + round duration can
  // cross midnight (e.g. hour 25), which formatTeeTime can't render correctly.
  const endMins = (th * 60 + tm + GOLF_ROUND_DURATION_MINUTES) % 1440
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
  processingBookingRequestId,
  onDecideRequest,
  remindingPayment,
  remindedPaymentIds,
  onRemindPayment,
  deletingBookingId,
  onRequestDelete,
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
  processingBookingRequestId: string | null
  onDecideRequest: (id: string, action: 'setup' | 'reject') => void
  remindingPayment: string | null
  remindedPaymentIds: Set<string>
  onRemindPayment: (id: string) => void
  deletingBookingId: string | null
  onRequestDelete: (b: BookingRow) => void
}) {
  const isExpanded = expandedSlots.has(slot.key)
  const totalAmount = slot.rows.reduce((sum, b) => sum + Number(b.amount_charged), 0)
  const activeRows = slot.rows.filter(b => b.status !== 'cancelled')
  const paidCount = activeRows.filter(b => ['payment_confirmed', 'confirmed'].includes(b.status)).length
  const allPaid = activeRows.length > 0 && paidCount === activeRows.length

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
        className="w-full px-4 py-3 text-left flex items-center justify-between gap-2 hover:bg-gray-50 transition-colors"
        onClick={() => onToggle(slot.key)}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <svg
            className={`w-3.5 h-3.5 flex-shrink-0 text-gray-400 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
          <div className="min-w-0 flex-1">
            {/* Time + course + attention — first line */}
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-semibold text-gray-800 whitespace-nowrap">
                {formatTeeTime(slot.tee_time)} – {slotEndTime(slot.tee_time)}
              </p>
              {showCourseName && slot.rows[0]?.course?.name && (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 whitespace-nowrap">
                  {slot.rows[0].course.name}
                </span>
              )}
              {hasAttention && (
                <span className="w-1.5 h-1.5 rounded-full bg-orange-400 flex-shrink-0" title="Needs attention" />
              )}
            </div>
            {/* Status chips — scrollable on mobile */}
            <div className="flex items-center gap-1 mt-1 overflow-x-auto pb-0.5 hide-scrollbar">
              {Object.entries(statusBreakdown).map(([status, count]) => {
                const meta = STATUS_META[status as BookingStatus]
                return (
                  <span key={status} className={`flex-shrink-0 flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${meta.colour}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                    {count} <span className="hidden sm:inline">{meta.label}</span>
                  </span>
                )
              })}
            </div>
          </div>
        </div>

        {/* Amount + count — always visible */}
        <div className="flex-shrink-0 text-right">
          <p className="text-xs font-semibold text-green-700">${totalAmount.toFixed(0)}</p>
          <p className="text-[10px] text-gray-400">{slot.rows.length}p</p>
          {activeRows.length > 0 && (
            <span className={`inline-block mt-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap ${
              allPaid ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
            }`}>
              {allPaid ? '✓' : '⚠'} {paidCount}/{activeRows.length} members paid
            </span>
          )}
        </div>
      </button>

      {/* Expanded: per-player rows */}
      {isExpanded && (
        <div className="divide-y divide-gray-50 border-t border-gray-100">
          {slot.rows.map(b => {
            const info = playerInfo(b)
            const sm = STATUS_META[b.status] ?? STATUS_META.tentative
            const daysLeftLabel = paymentDaysLeftLabel(b)
            const showRemindCta = !!daysLeftLabel && canRemindPayment(b)
            const alreadyReminded = remindedPaymentIds.has(b.id)
            return (
              <div key={b.id} className="px-4 py-3">
                {/* Top: name + status (side by side) */}
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-sm font-medium text-gray-800 truncate">{info.name}</p>
                      {info.badge && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 flex-shrink-0">
                          {info.badge}
                        </span>
                      )}
                      {daysLeftLabel && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 flex-shrink-0 whitespace-nowrap">
                          ⏳ {daysLeftLabel}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5 truncate">{info.sub}</p>
                  </div>

                  {/* Status + dinner — stacked, right-aligned */}
                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                    {b.status === 'awaiting_approval' ? (
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => onDecideRequest(b.id, 'setup')}
                          disabled={processingBookingRequestId === b.id}
                          className="text-xs font-medium px-2.5 py-1 rounded-lg bg-green-900 text-white disabled:opacity-50 whitespace-nowrap"
                        >
                          {processingBookingRequestId === b.id ? '…' : 'Setup'}
                        </button>
                        <button
                          onClick={() => onDecideRequest(b.id, 'reject')}
                          disabled={processingBookingRequestId === b.id}
                          className="text-xs font-medium px-2.5 py-1 rounded-lg bg-red-50 text-red-600 disabled:opacity-50 whitespace-nowrap"
                        >
                          ✕ Reject
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        {showRemindCta && (
                          <button
                            type="button"
                            onClick={() => onRemindPayment(b.id)}
                            disabled={remindingPayment === b.id || alreadyReminded}
                            className="text-xs font-medium px-2.5 py-1 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:hover:bg-red-600 whitespace-nowrap transition-colors"
                          >
                            {remindingPayment === b.id ? 'Sending…' : alreadyReminded ? '✓ Sent' : 'Send reminder'}
                          </button>
                        )}
                        <select
                          value={b.status}
                          disabled={updatingStatus === b.id}
                          onChange={e => onUpdateStatus(b.id, e.target.value as BookingStatus)}
                          className={`text-xs font-semibold rounded-lg px-2 py-1 border border-transparent outline-none cursor-pointer disabled:opacity-50 transition-colors max-w-[140px] sm:max-w-none ${sm.colour}`}
                        >
                          {(STATUS_ACTIONS.includes(b.status) ? STATUS_ACTIONS : [b.status, ...STATUS_ACTIONS]).map(s => (
                            <option key={s} value={s}>{STATUS_META[s].label}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    {b.dinner_rsvp ? (
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${
                        b.dinner_rsvp === 'yes'   ? 'bg-green-50 text-green-600' :
                        b.dinner_rsvp === 'maybe' ? 'bg-yellow-50 text-yellow-600' :
                                                    'bg-gray-100 text-gray-400'
                      }`}>
                        🍽 {b.dinner_rsvp === 'yes' ? 'Yes' : b.dinner_rsvp === 'no' ? 'No' : 'Maybe'}
                      </span>
                    ) : null}
                  </div>
                </div>

                {/* Note — full width below */}
                {editingNote === b.id ? (
                  <div className="flex flex-col gap-1.5 mt-1" onClick={e => e.stopPropagation()} role="presentation">
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
                  <div className="flex items-center justify-between gap-2 mt-1">
                    <button onClick={() => onEditNote(b.id)}
                      className="min-w-0 flex-1 text-xs text-left text-gray-400 hover:text-gray-600 transition-colors italic truncate">
                      {b.admin_notes ?? 'Add note…'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onRequestDelete(b)}
                      disabled={deletingBookingId === b.id}
                      className="flex-shrink-0 flex items-center gap-1 text-xs font-medium text-red-500 hover:text-red-700 px-2 py-1 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                      </svg>
                      {deletingBookingId === b.id ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---- Filter helpers ---------------------------------------------------

function FilterField({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <label htmlFor={htmlFor} className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
        {label}
      </label>
      {children}
    </div>
  )
}

function FunnelIcon() {
  return (
    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 4.5h18M6 9h12M9.75 13.5h4.5M11.25 18h1.5" />
    </svg>
  )
}

// Mobile-only bottom sheet holding every filter field — desktop shows them
// inline instead (see the "hidden sm:grid" block in the main render).
function FiltersDrawer({
  open,
  onClose,
  onClear,
  hasActiveFilters,
  children,
}: {
  open: boolean
  onClose: () => void
  onClear: () => void
  hasActiveFilters: boolean
  children: React.ReactNode
}) {
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (open) {
      setMounted(true)
      const ids: number[] = []
      ids[0] = requestAnimationFrame(() => { ids[1] = requestAnimationFrame(() => setVisible(true)) })
      return () => ids.forEach(id => cancelAnimationFrame(id))
    } else {
      setVisible(false)
      const t = setTimeout(() => setMounted(false), 250)
      return () => clearTimeout(t)
    }
  }, [open])

  if (!mounted) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end sm:hidden">
      <button
        type="button"
        aria-label="Close filters"
        className="absolute inset-0 w-full h-full"
        style={{ background: 'rgba(0,0,0,0.4)', opacity: visible ? 1 : 0, transition: 'opacity 200ms ease-out' }}
        onClick={onClose}
      />
      <div
        className="relative bg-white rounded-t-2xl px-4 pt-4 pb-6 max-h-[85vh] overflow-y-auto"
        style={{
          transform: visible ? 'translateY(0)' : 'translateY(100%)',
          transition: visible ? 'transform 280ms cubic-bezier(0.32,0.72,0,1)' : 'transform 200ms cubic-bezier(0.4,0,1,1)',
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-gray-800">Filters</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 rounded-full flex items-center justify-center bg-gray-100 text-gray-500"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-3">{children}</div>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={onClear}
            className="w-full mt-5 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600"
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  )
}

// ---- Main page -------------------------------------------------------

export default function AdminBookingsPage() {
  const searchParams = useSearchParams()
  const urlCourseId = searchParams.get('courseId') ?? 'all'

  const [bookings, setBookings] = useState<BookingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<BookingsView>('all')
  const [courseList, setCourseList] = useState<CourseListItem[]>([])
  const [courseFilter, setCourseFilter] = useState<string>(urlCourseId)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [dinnerFilter, setDinnerFilter] = useState<DinnerFilter>('all')
  const [locationFilter, setLocationFilter] = useState<string>('all')
  const [tagFilter, setTagFilter] = useState<string>('all')
  const [eventNameFilter, setEventNameFilter] = useState('')
  const [debouncedEventName, setDebouncedEventName] = useState('')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null)
  const [editingNote, setEditingNote] = useState<string | null>(null)
  const [noteValues, setNoteValues] = useState<Record<string, string>>({})
  const [savingNote, setSavingNote] = useState<string | null>(null)
  const [expandedSlots, setExpandedSlots] = useState<Set<string>>(new Set())
  const [remindingPayment, setRemindingPayment] = useState<string | null>(null)
  const [remindedPaymentIds, setRemindedPaymentIds] = useState<Set<string>>(new Set())
  const [deletingBookingId, setDeletingBookingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<BookingRow | null>(null)
  const noteRef = useRef<HTMLTextAreaElement>(null)

  const [activeTab, setActiveTab] = useState<'bookings' | 'access'>('bookings')
  const [allMembers, setAllMembers] = useState<AccessMemberRow[]>([])
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [processingMemberId, setProcessingMemberId] = useState<string | null>(null)
  const [addMemberSearch, setAddMemberSearch] = useState('')

  const [processingBookingRequestId, setProcessingBookingRequestId] = useState<string | null>(null)
  const [requestToast, setRequestToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)

  // Sync URL → filter when navigating from the nav sidebar (clicking a specific
  // course under "Booking Courses"). Once a course is pinned this way, the
  // cross-course narrowing filters (location/tags/event name) no longer apply
  // — they're for slicing "All Bookings" without picking one exact course —
  // so clear them to avoid a hidden, still-active filter.
  useEffect(() => {
    setCourseFilter(urlCourseId)
    if (urlCourseId !== 'all') {
      setLocationFilter('all')
      setTagFilter('all')
      setEventNameFilter('')
    }
  }, [urlCourseId])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedEventName(eventNameFilter), 350)
    return () => clearTimeout(t)
  }, [eventNameFilter])

  const loadBookings = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const today    = format(new Date(), 'yyyy-MM-dd')

    // All:          no date bounds — every booking regardless of date (default)
    // Upcoming:     today → 365 days ahead
    // Who's Playing: today → 30 days ahead — a shorter lookahead preset of the
    //               "upcoming" window.
    // Past:         365 days ago → yesterday
    // A custom From/To range overrides the view-based window when both are set.
    // The final list is always grouped chronologically by date regardless of
    // view (see groupByDate), so the query sort direction only affects fetch
    // order, not what the admin ends up seeing.
    // Payment status (unpaid) is just another status filter — it doesn't
    // override the date window. The "days left" badge (see paymentDaysLeftLabel)
    // is what narrows attention to bookings within PAYMENT_OVERDUE_WINDOW_DAYS.
    const isUpcoming  = view !== 'past'
    const isAllView   = view === 'all'
    const hasCustomRange = !!customFrom && !!customTo
    // A null bound means "unbounded on that side" — the All view fetches
    // everything, so it applies no date filter unless a custom range is set.
    const rangeStart: string | null = hasCustomRange ? customFrom
      : isAllView ? null
      : isUpcoming ? today
      : format(subDays(new Date(), 365), 'yyyy-MM-dd')
    const rangeEnd: string | null = hasCustomRange ? customTo
      : isAllView ? null
      : view === 'whos-playing' ? format(addDays(new Date(), WHOS_PLAYING_WINDOW_DAYS), 'yyyy-MM-dd')
      : isUpcoming ? format(addDays(new Date(), 365), 'yyyy-MM-dd')
      : format(subDays(new Date(), 1), 'yyyy-MM-dd')

    const { data: courses } = await supabase
      .from('courses')
      .select('id, name, description, city, state, access_tag, required_tags')
      .eq('active', true)
      .eq('approval_status', 'active')
      .order('name')

    const allCourses = courses ?? []
    setCourseList(allCourses)

    // A specific course (picked via the sidebar "Booking Courses" list) pins
    // course_id directly. Location/Tags/Event-name are cross-course narrowing
    // tools for the "All Bookings" case — they're hidden and reset to defaults
    // once a specific course is selected (see the urlCourseId effect above),
    // so guarding on isAllCourses here is defensive, not load-bearing.
    const isAllCourses = courseFilter === 'all'
    const eventNameQuery = isAllCourses ? debouncedEventName.trim().toLowerCase() : ''
    const matchingCourseIds = allCourses
      .filter(c => isAllCourses || c.id === courseFilter)
      .filter(c => !isAllCourses || locationFilter === 'all' || `${c.city}, ${c.state}` === locationFilter)
      .filter(c => !isAllCourses || tagFilter === 'all' || (c.required_tags ?? []).includes(tagFilter))
      .filter(c => !eventNameQuery || c.name.toLowerCase().includes(eventNameQuery) || (c.description ?? '').toLowerCase().includes(eventNameQuery))
      .map(c => c.id)

    if (matchingCourseIds.length === 0) { setBookings([]); setLoading(false); return }

    const SELECT = 'id, member_id, created_at, booking_date, tee_time, players, guest_name, player_member_id, additional_players, status, amount_charged, dinner_rsvp, admin_notes, ghl_opportunity_id, course_id, member:members!bookings_member_id_fkey(first_name, last_name, email), course:courses!bookings_course_id_fkey(name)'
    const SELECT_NO_DINNER = SELECT.replace('dinner_rsvp, ', '')

    function buildQuery(select: string) {
      let q = supabase
        .from('bookings')
        .select(select)
        .in('course_id', matchingCourseIds)
      if (rangeStart) q = q.gte('booking_date', rangeStart)
      if (rangeEnd) q = q.lte('booking_date', rangeEnd)
      if (statusFilter === 'payment_overdue') q = q.eq('status', 'availability_confirmed')
      else if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (dinnerFilter !== 'all') {
        q = dinnerFilter === 'none' ? q.is('dinner_rsvp', null) : q.eq('dinner_rsvp', dinnerFilter)
      }
      return q
        .order('booking_date', { ascending: isUpcoming })
        .order('tee_time',     { ascending: isUpcoming })
    }

    let { data, error } = await buildQuery(SELECT)

    // Fallback without dinner_rsvp if column doesn't exist yet — the dinner
    // filter itself can't be enforced in that (legacy) case.
    if (error?.message?.includes('dinner_rsvp')) {
      const fallback = await buildQuery(SELECT_NO_DINNER)
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
  }, [view, courseFilter, locationFilter, tagFilter, debouncedEventName, statusFilter, dinnerFilter, customFrom, customTo])

  useEffect(() => { loadBookings() }, [loadBookings])
  useEffect(() => { if (editingNote && noteRef.current) noteRef.current.focus() }, [editingNote])

  async function decideBookingRequest(id: string, action: 'setup' | 'reject') {
    setProcessingBookingRequestId(id)
    const res = await fetch(`/api/admin/booking-requests/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    if (res.ok) {
      setRequestToast({ msg: action === 'setup' ? 'Guest set up, booked, and synced.' : 'Guest request rejected.', ok: true })
    } else {
      const json = await res.json().catch(() => ({}))
      setRequestToast({ msg: json.error ?? 'Action failed. Please try again.', ok: false })
    }
    setTimeout(() => setRequestToast(null), 3500)
    await loadBookings()
    setProcessingBookingRequestId(null)
  }

  const loadMembers = useCallback(async () => {
    setLoadingMembers(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('members')
      .select('id, first_name, last_name, email, ghl_tags')
      .order('first_name')
    setAllMembers((data ?? []) as AccessMemberRow[])
    setLoadingMembers(false)
  }, [])

  useEffect(() => { loadMembers() }, [loadMembers])

  // Reset to the Bookings tab when leaving a specific course — the Access
  // tab only makes sense scoped to one event.
  useEffect(() => {
    if (courseFilter === 'all') setActiveTab('bookings')
  }, [courseFilter])

  const currentCourse = courseList.find(c => c.id === courseFilter) ?? null

  const courseAccessTags = useMemo(
    () => currentCourse
      ? [...new Set([currentCourse.access_tag, ...(currentCourse.required_tags ?? [])].filter(Boolean))]
      : [],
    [currentCourse]
  )

  const membersWithAccess = useMemo(
    () => allMembers.filter(m => (m.ghl_tags ?? []).some(t => courseAccessTags.includes(t))),
    [allMembers, courseAccessTags]
  )
  const membersWithAccessIds = useMemo(
    () => new Set(membersWithAccess.map(m => m.id)),
    [membersWithAccess]
  )

  const addMemberMatches = useMemo(() => {
    if (!addMemberSearch.trim()) return []
    const q = addMemberSearch.toLowerCase()
    return allMembers
      .filter(m => !membersWithAccessIds.has(m.id))
      .filter(m => `${m.first_name} ${m.last_name}`.toLowerCase().includes(q) || m.email.toLowerCase().includes(q))
      .slice(0, 8)
  }, [addMemberSearch, allMembers, membersWithAccessIds])

  async function grantAccess(memberId: string) {
    if (!currentCourse?.access_tag) return
    setProcessingMemberId(memberId)
    const res = await fetch('/api/admin/members/bulk-tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberIds: [memberId], tag: currentCourse.access_tag, action: 'add' }),
    })
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      setRequestToast({ msg: json.error ?? 'Failed to grant access. Please try again.', ok: false })
      setTimeout(() => setRequestToast(null), 3500)
    }
    await loadMembers()
    setAddMemberSearch('')
    setProcessingMemberId(null)
  }

  async function revokeAccess(memberId: string) {
    if (!currentCourse?.access_tag) return
    setProcessingMemberId(memberId)
    const res = await fetch('/api/admin/members/bulk-tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberIds: [memberId], tag: currentCourse.access_tag, action: 'remove' }),
    })
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      setRequestToast({ msg: json.error ?? 'Failed to remove access. Please try again.', ok: false })
      setTimeout(() => setRequestToast(null), 3500)
    }
    await loadMembers()
    setProcessingMemberId(null)
  }

  // Status/dinner-RSVP/venue/location/tags are already applied server-side in
  // loadBookings — only free-text search (out of scope for server-side filtering,
  // see plan) is re-checked here.
  const filtered = useMemo(() => bookings.filter(b => {
    const info = playerInfo(b)
    const q = search.toLowerCase()
    return !search || info.name.toLowerCase().includes(q) || info.sub.toLowerCase().includes(q)
  }), [bookings, search])

  const locationOptions = useMemo(() => {
    const set = new Set(courseList.filter(c => c.city || c.state).map(c => `${c.city}, ${c.state}`))
    return [...set].sort()
  }, [courseList])

  const tagOptions = useMemo(() => {
    const set = new Set(courseList.flatMap(c => c.required_tags ?? []))
    return [...set].sort()
  }, [courseList])

  // Course selection itself is driven by the sidebar's "Booking Courses" list
  // (and highlighted there), so it's intentionally excluded here — this only
  // covers filters this page's own controls can set and clear.
  const hasActiveFilters = statusFilter !== 'all' || dinnerFilter !== 'all'
    || locationFilter !== 'all' || tagFilter !== 'all' || !!eventNameFilter || !!search || !!customFrom || !!customTo

  // Count of active fields inside the mobile Filters drawer specifically
  // (excludes Search, which stays visible outside the drawer) — drives the
  // badge on the mobile "Filters" button.
  const activeFilterCount = [
    statusFilter !== 'all',
    dinnerFilter !== 'all',
    !!customFrom || !!customTo,
    locationFilter !== 'all',
    tagFilter !== 'all',
    !!eventNameFilter,
  ].filter(Boolean).length

  function clearFilters() {
    setSearch('')
    setStatusFilter('all')
    setDinnerFilter('all')
    setLocationFilter('all')
    setTagFilter('all')
    setEventNameFilter('')
    setCustomFrom('')
    setCustomTo('')
  }

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
    try {
      const res = await fetch(`/api/admin/bookings/${bookingId}/status`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (res.ok) {
        setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, status } : b))
      } else {
        const json = await res.json().catch(() => ({}))
        setRequestToast({ msg: json.error ?? 'Failed to update status. Please try again.', ok: false })
        setTimeout(() => setRequestToast(null), 3500)
      }
    } catch {
      setRequestToast({ msg: 'Network error. Please try again.', ok: false })
      setTimeout(() => setRequestToast(null), 3500)
    } finally {
      setUpdatingStatus(null)
    }
  }

  async function saveNote(bookingId: string) {
    setSavingNote(bookingId)
    try {
      const res = await fetch(`/api/admin/bookings/${bookingId}/notes`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ admin_notes: noteValues[bookingId] ?? '' }),
      })
      if (res.ok) {
        setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, admin_notes: noteValues[bookingId] || null } : b))
        setEditingNote(null)
      } else {
        const json = await res.json().catch(() => ({}))
        setRequestToast({ msg: json.error ?? 'Failed to save note. Please try again.', ok: false })
        setTimeout(() => setRequestToast(null), 3500)
      }
    } catch {
      setRequestToast({ msg: 'Network error. Please try again.', ok: false })
      setTimeout(() => setRequestToast(null), 3500)
    } finally {
      setSavingNote(null)
    }
  }

  async function remindPayment(bookingId: string) {
    setRemindingPayment(bookingId)
    const res = await fetch(`/api/admin/bookings/${bookingId}/remind-payment`, { method: 'POST' })
    if (res.ok) {
      setRemindedPaymentIds(prev => new Set(prev).add(bookingId))
      setRequestToast({ msg: 'Payment reminder texted.', ok: true })
    } else {
      const json = await res.json().catch(() => ({}))
      setRequestToast({ msg: json.error ?? 'Failed to send reminder. Please try again.', ok: false })
    }
    setTimeout(() => setRequestToast(null), 3500)
    setRemindingPayment(null)
  }

  async function confirmDeleteBooking() {
    if (!deleteTarget) return
    const id = deleteTarget.id
    setDeletingBookingId(id)
    try {
      const res = await fetch(`/api/admin/bookings/${id}`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (res.ok) {
        setBookings(prev => prev.filter(b => b.id !== id))
        setRequestToast({
          msg: json.ghlDeleted === false
            ? 'Booking deleted, but its GHL booking could not be removed.'
            : 'Booking deleted from LinkUp and GHL.',
          ok: json.ghlDeleted !== false,
        })
      } else {
        setRequestToast({ msg: json.error ?? 'Failed to delete booking. Please try again.', ok: false })
      }
    } catch {
      setRequestToast({ msg: 'Network error. Please try again.', ok: false })
    } finally {
      setDeleteTarget(null)
      setTimeout(() => setRequestToast(null), 3500)
      setDeletingBookingId(null)
    }
  }

  function toggleSlot(key: string) {
    setExpandedSlots(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
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
    const a = document.createElement('a'); a.href = url; a.download = `bookings-${view}-${format(new Date(), 'yyyy-MM-dd')}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const slotProps = {
    expandedSlots, onToggle: toggleSlot,
    updatingStatus, onUpdateStatus: updateStatus,
    editingNote, noteValues,
    onEditNote: setEditingNote,
    onNoteChange: (id: string, val: string) => setNoteValues(prev => ({ ...prev, [id]: val })),
    onSaveNote: saveNote, savingNote, noteRef,
    processingBookingRequestId, onDecideRequest: decideBookingRequest,
    remindingPayment, remindedPaymentIds, onRemindPayment: remindPayment,
    deletingBookingId, onRequestDelete: setDeleteTarget,
  }

  // Shared between the desktop inline grid and the mobile drawer — id suffix
  // keeps the two rendered copies' element ids unique in the DOM.
  function renderFilterFields(idSuffix: string) {
    return (
      <>
        <FilterField label="Status" htmlFor={`status-${idSuffix}`}>
          <Select
            id={`status-${idSuffix}`}
            value={statusFilter}
            onChange={v => setStatusFilter(v as StatusFilter)}
            options={STATUS_FILTERS.map(s => ({
              value: s,
              label: s === 'all' ? 'All statuses' : (STATUS_FILTER_LABELS[s] ?? STATUS_META[s as BookingStatus].label),
            }))}
            placeholder="All statuses"
            className="w-full"
            triggerClassName="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg flex items-center justify-between gap-2 bg-white"
          />
        </FilterField>
        <FilterField label="Dinner RSVP" htmlFor={`dinner-${idSuffix}`}>
          <Select
            id={`dinner-${idSuffix}`}
            value={dinnerFilter}
            onChange={v => setDinnerFilter(v as DinnerFilter)}
            options={DINNER_FILTERS.map(d => ({ value: d, label: DINNER_FILTER_LABELS[d] }))}
            placeholder="All dinner RSVPs"
            className="w-full"
            triggerClassName="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg flex items-center justify-between gap-2 bg-white"
          />
        </FilterField>
        <FilterField label="From" htmlFor={`from-${idSuffix}`}>
          <input
            id={`from-${idSuffix}`}
            type="date" value={customFrom}
            onChange={e => setCustomFrom(e.target.value)}
            className="w-full px-2.5 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-900/20"
          />
        </FilterField>
        <FilterField label="To" htmlFor={`to-${idSuffix}`}>
          <input
            id={`to-${idSuffix}`}
            type="date" value={customTo}
            onChange={e => setCustomTo(e.target.value)}
            className="w-full px-2.5 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-900/20"
          />
        </FilterField>

        {courseFilter === 'all' && (
          <>
            <FilterField label="Location" htmlFor={`location-${idSuffix}`}>
              <Select
                id={`location-${idSuffix}`}
                value={locationFilter}
                onChange={setLocationFilter}
                options={[{ value: 'all', label: 'All locations' }, ...locationOptions.map(l => ({ value: l, label: l }))]}
                placeholder="All locations"
                searchPlaceholder="Search locations…"
                className="w-full"
                triggerClassName="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg flex items-center justify-between gap-2 bg-white"
              />
            </FilterField>
            <FilterField label="Tags" htmlFor={`tags-${idSuffix}`}>
              <Select
                id={`tags-${idSuffix}`}
                value={tagFilter}
                onChange={setTagFilter}
                options={[{ value: 'all', label: 'All tags' }, ...tagOptions.map(t => ({ value: t, label: t }))]}
                placeholder="All tags"
                searchPlaceholder="Search tags…"
                className="w-full"
                triggerClassName="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg flex items-center justify-between gap-2 bg-white"
              />
            </FilterField>
            <FilterField label="Event name" htmlFor={`event-name-${idSuffix}`}>
              <input
                id={`event-name-${idSuffix}`}
                type="text" placeholder="Event name…" value={eventNameFilter}
                onChange={e => setEventNameFilter(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-900/20"
              />
            </FilterField>
          </>
        )}
      </>
    )
  }

  // ---- Render ---------------------------------------------------------
  return (
    <div className="p-4 sm:p-6">
      {requestToast && (
        <div className={`fixed top-6 right-6 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium max-w-sm ${
          requestToast.ok ? 'bg-green-900 text-white' : 'bg-red-600 text-white'
        }`}>
          {requestToast.msg}
        </div>
      )}

      {/* Delete confirmation dialog — deletion removes the row from both
          LinkUp (Supabase) and GHL and cannot be undone. */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-5">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-50 flex items-center justify-center">
                <svg className="w-5 h-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-gray-800">Delete booking?</h2>
                <p className="text-xs text-gray-500 mt-1">
                  This permanently removes{' '}
                  <span className="font-medium text-gray-700">{playerInfo(deleteTarget).name || 'this booking'}</span>
                  {deleteTarget.course?.name ? ` at ${deleteTarget.course.name}` : ''} on{' '}
                  {format(new Date(`${deleteTarget.booking_date}T12:00:00`), 'MMM d, yyyy')} at {formatTeeTime(deleteTarget.tee_time)}.
                  It deletes the booking from both LinkUp and GHL and cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deletingBookingId === deleteTarget.id}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteBooking}
                disabled={deletingBookingId === deleteTarget.id}
                className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {deletingBookingId === deleteTarget.id ? 'Deleting…' : 'Delete booking'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header row: title + view toggle */}
      <div className="flex items-start justify-between gap-3 mb-5">
        <AdminPageHeader
          title={courseFilter === 'all'
            ? 'All Bookings'
            : (courseList.find(c => c.id === courseFilter)?.name ?? 'Bookings')}
          description={courseList.length > 0
            ? `${courseList.length} active course${courseList.length !== 1 ? 's' : ''}`
            : undefined}
        />
        {/* Upcoming / Who's Playing / Past toggle — compact on mobile */}
        <div className="flex p-0.5 rounded-xl flex-shrink-0 self-start" style={{ background: 'rgba(0,38,105,0.06)' }}>
          {(['all', 'upcoming', 'whos-playing', 'past'] as const).map(v => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className="px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-semibold rounded-[10px] transition-all whitespace-nowrap"
              style={view === v
                ? { background: 'white', color: 'var(--color-green-900)', boxShadow: '0 1px 3px rgba(0,38,105,0.1)' }
                : { color: 'rgba(0,38,105,0.45)' }}
            >
              {VIEW_LABELS[v]}
            </button>
          ))}
        </div>
      </div>

      {/* Tabs — only meaningful once a specific event/course is pinned via the sidebar */}
      {courseFilter !== 'all' && (
        <div className="flex gap-1 mb-5 border-b border-gray-100">
          {(['bookings', 'access'] as const).map(tab => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
                activeTab === tab
                  ? 'border-green-900 text-green-900'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              {tab === 'bookings' ? 'Bookings' : 'Access'}
            </button>
          ))}
        </div>
      )}

      {courseFilter !== 'all' && activeTab === 'access' ? (
        <div className="space-y-8">
          {/* Add an existing member directly */}
          <div>
            <h2 className="text-sm font-bold text-gray-700 mb-2">Add Member</h2>
            <div className="relative max-w-sm">
              <input
                type="search"
                placeholder="Search members by name or email…"
                value={addMemberSearch}
                onChange={e => setAddMemberSearch(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-900/20"
              />
              {addMemberMatches.length > 0 && (
                <div className="absolute z-10 mt-1 w-full bg-white border border-gray-100 rounded-xl shadow-lg overflow-hidden">
                  {addMemberMatches.map(m => (
                    <div key={m.id} className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-gray-50">
                      <div className="min-w-0">
                        <p className="text-sm text-gray-800 truncate capitalize">{m.first_name} {m.last_name}</p>
                        <p className="text-xs text-gray-400 truncate">{m.email}</p>
                      </div>
                      <button
                        onClick={() => grantAccess(m.id)}
                        disabled={processingMemberId === m.id}
                        className="flex-shrink-0 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-green-900 text-white disabled:opacity-50"
                      >
                        + Add
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Members currently with access */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-sm font-bold text-gray-700">Members With Access</h2>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                {membersWithAccess.length}
              </span>
            </div>
            {loadingMembers ? (
              <div className="h-12 bg-gray-100 rounded-xl animate-pulse" />
            ) : membersWithAccess.length === 0 ? (
              <p className="text-xs text-gray-400 italic px-1">No members have access to this event yet.</p>
            ) : (
              <div className="space-y-2">
                {membersWithAccess.map(m => (
                  <div key={m.id} className="bg-white border border-gray-100 rounded-xl shadow-sm px-4 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate capitalize">{m.first_name} {m.last_name}</p>
                      <p className="text-xs text-gray-400 truncate">{m.email}</p>
                    </div>
                    <button
                      onClick={() => revokeAccess(m.id)}
                      disabled={processingMemberId === m.id}
                      className="flex-shrink-0 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-red-50 text-red-600 disabled:opacity-50"
                    >
                      Remove access
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
      {/* Stats — 2 cols mobile, 4 cols desktop */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 mb-5">
        <StatCard label="Active"        value={confirmed} sub="Confirmed / avail. confirmed" colour="green" />
        <StatCard label="Pending"       value={tentative} sub="Tentative / awaiting approval" colour="blue" />
        <StatCard label="Revenue"       value={`$${revenue.toLocaleString()}`} sub="Confirmed + payment" colour="green" />
        <StatCard label="Attention"     value={attention} sub="Awaiting admin approval" colour={attention > 0 ? 'red' : 'gray'} />
      </div>

      {/* Filter bar */}
      <div className="space-y-2 mb-5">
        {/* Row 1: search + actions. On mobile, a "Filters" button opens the
            drawer below instead of showing every field inline. */}
        <div className="flex items-center gap-2">
          <input
            type="text" placeholder="Search player…" value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 min-w-0 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-900/20"
          />
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            className="sm:hidden relative flex-shrink-0 flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <FunnelIcon />
            Filters
            {activeFilterCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-green-900 text-white text-[9px] font-bold flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </button>
          {allSlots.length > 0 && (
            <div className="hidden sm:flex items-center gap-1">
              <button onClick={expandAll}  className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5 rounded-lg hover:bg-gray-50">Expand all</button>
              <button onClick={collapseAll} className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5 rounded-lg hover:bg-gray-50">Collapse</button>
            </div>
          )}
          <button onClick={exportCSV} disabled={filtered.length === 0}
            className="flex-shrink-0 flex items-center gap-1 px-3 py-2 text-xs font-medium bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-colors">
            ↓ <span className="hidden sm:inline">CSV</span>
          </button>
        </div>

        {/* Row 2: filter controls — desktop/tablet only, laid out in a grid so
            fields wrap predictably instead of an uneven flex-wrap cascade.
            Course selection itself lives in the sidebar's "Booking Courses"
            list; location/tags/event name only make sense while browsing
            "All Bookings" (they narrow across courses), so they're hidden
            once a specific course is pinned via the sidebar. */}
        <div className="hidden sm:grid sm:grid-cols-2 lg:grid-cols-4 gap-3 items-start">
          {renderFilterFields('desktop')}

          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="self-end text-xs font-medium text-gray-400 hover:text-gray-600 px-2 py-2 rounded-lg hover:bg-gray-50 justify-self-start"
            >
              Clear filters
            </button>
          )}
        </div>

        <FiltersDrawer
          open={filtersOpen}
          onClose={() => setFiltersOpen(false)}
          onClear={() => { clearFilters(); setFiltersOpen(false) }}
          hasActiveFilters={hasActiveFilters}
        >
          {renderFilterFields('mobile')}
        </FiltersDrawer>
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
          <p className="text-xs text-gray-400 mt-1">Try adjusting the filters or switching between Upcoming / Past.</p>
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
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-px flex-1 bg-gray-100 hidden sm:block" />
                  <div className="flex items-center gap-2 flex-wrap">
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
          {filtered.length} player{filtered.length !== 1 ? 's' : ''} · {allSlots.length} tee slot{allSlots.length !== 1 ? 's' : ''} · {VIEW_LABELS[view].toLowerCase()}
        </p>
      )}
        </>
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
  if (dateGroups.length === 0) return null
  return (
    <div className="space-y-4">
      {dateGroups.map(dg => (
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
  )
}
