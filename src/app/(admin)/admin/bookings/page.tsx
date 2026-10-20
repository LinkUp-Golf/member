'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { AdminPageHeader, StatCard } from '@/components/admin/AdminUI'
import Select from '@/components/ui/Select'
import { format, addDays, subDays, isToday, differenceInCalendarDays } from 'date-fns'
import { formatTeeTime, titleCaseName } from '@/lib/utils'
import { tagsOverlap } from '@/lib/ghl/tags'
import { settlingAtClub, PAY_AT_CLUB_LABEL } from '@/lib/bookings/payment-options'
import { inviteStatusLabel } from '@/lib/bookings/invitations'
import AdminNewBookingDrawer from '@/components/admin/AdminNewBookingDrawer'
import { slotWallTime, useVenueSlots } from '@/hooks/useVenueSlots'
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
  /** 'pay_at_club' when the member chose to settle with the club. */
  payment_method: 'pay_at_club' | null
  /** The booker covers this added player's seat. */
  paid_by_booker?: boolean
  /** An added player's answer to their invitation; null on older rows and the booker's own. */
  invite_status?: 'pending' | 'accepted' | 'declined' | 'expired' | null
  ghl_opportunity_id: string | null
  member: { first_name: string; last_name: string; email: string } | null
  player?: { id: string; first_name: string; last_name: string; email: string } | null
  course?: { name: string; id?: string } | null
  course_id?: string
  // Attached after loading (see loadBookings) — a booking with credit put
  // toward it. Void/expired codes are kept rather than dropped: they say credit
  // was attempted here, which is worth seeing when a payment is chased.
  credit_coupon?: BookingCoupon | null
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

// How a round was settled. Members can pay cash at the venue's checkout or put
// credit toward it, and credit arrives as a GHL coupon code issued against the
// booking row — so a row with a credit coupon attached is one paid (wholly or
// partly) with credit, and everything else is cash.
//
// Not a column on bookings: the coupon is the record, and inferring from it
// keeps one source of truth for "was credit used here". 'credits' matches rows
// with any coupon, 'cash' those with none.
const PAYMENT_FILTERS = ['all', 'credits', 'cash'] as const
type PaymentFilter = typeof PAYMENT_FILTERS[number]
const PAYMENT_FILTER_LABELS: Record<PaymentFilter, string> = {
  all: 'Cash or credits',
  credits: '🎟 Paid with credits',
  cash: 'Cash only',
}

// The credit code attached to a booking row, as this page needs it.
interface BookingCoupon {
  id: string
  code: string
  amount: number
  status: 'issued' | 'redeemed' | 'void' | 'expired'
}

const COUPON_STATUS_LABEL: Record<BookingCoupon['status'], string> = {
  issued: 'code issued',
  redeemed: 'credit used',
  void: 'returned',
  expired: 'expired',
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

// One booking: the rows inserted together for one booker. A tee time can hold
// several of them, and two separate bookings landing on the same tee time by
// coincidence must not be merged into one — so this is keyed by
// (booker + tee time + created_at) rather than just date/time. Rows inserted
// together (one transaction) share the exact same created_at, since Postgres
// evaluates now() once per statement.
type TeeSlot = { key: string; booking_date: string; tee_time: string; created_at: string; rows: BookingRow[] }
// Every booking at one venue on one date and tee time — one card in the list.
type TeeTimeGroup = { key: string; booking_date: string; tee_time: string; isToday: boolean; slots: TeeSlot[] }

// The booker's own seat, as opposed to a member or guest they added.
function isBookerRow(b: BookingRow): boolean {
  return !b.guest_name && !b.player_member_id
}

function groupBySlot(bookings: BookingRow[]): TeeSlot[] {
  const map = new Map<string, BookingRow[]>()
  for (const b of bookings) {
    const key = `${b.member_id}_${b.created_at}_${b.booking_date}_${b.tee_time}`
    const arr = map.get(key) ?? []
    arr.push(b)
    map.set(key, arr)
  }
  return [...map.entries()].map(([key, rows]) => {
    const first = rows[0]!
    // The booker heads their own group; the players they added follow.
    const ordered = [...rows].sort((a, b) => Number(isBookerRow(b)) - Number(isBookerRow(a)))
    return { key, booking_date: first.booking_date, tee_time: first.tee_time, created_at: first.created_at, rows: ordered }
  })
}

// Bookings gathered under their date + tee time, one card each.
//
// Dates run latest round first — a date is the one thing in this list a reader
// already holds in their head, so it's what the headings count down. Within a date
// the tee times run in the order the day plays, and within a tee time the
// bookings run in the order they came in, so the first box is the first player
// who claimed the slot. Keyed by venue as well: two venues can share a tee time,
// and the all-bookings view can list both.
function groupByTeeTime(slots: TeeSlot[]): TeeTimeGroup[] {
  const map = new Map<string, TeeSlot[]>()
  for (const slot of slots) {
    const key = `${slot.booking_date}_${slot.tee_time}_${slot.rows[0]?.course_id ?? ''}`
    const arr = map.get(key) ?? []
    arr.push(slot)
    map.set(key, arr)
  }
  return [...map.entries()]
    .map(([key, s]) => {
      const { booking_date, tee_time } = s[0] as TeeSlot
      return {
        key,
        booking_date,
        tee_time,
        isToday: isToday(new Date(`${booking_date}T12:00:00`)),
        slots: [...s].sort((a, b) => a.created_at.localeCompare(b.created_at)),
      }
    })
    // 'YYYY-MM-DD' and 'HH:MM:SS' both sort chronologically as strings, so
    // there is no date arithmetic here to get wrong across a timezone.
    .sort((a, b) => b.booking_date.localeCompare(a.booking_date) || a.tee_time.localeCompare(b.tee_time) || a.key.localeCompare(b.key))
}

// Names arrive as typed — at signup, from GHL, or into a guest form — so they're
// title-cased here rather than trusted. The contact line is left as it is: an
// email address has to stay as written to be recognised.
function playerInfo(b: BookingRow): { name: string; sub: string; badge?: string } {
  if (b.guest_name) {
    const guest = b.additional_players?.[0]
    const contact = [guest?.email, guest?.mobile].filter(Boolean).join(' · ')
    return { name: titleCaseName(b.guest_name.trim()), sub: contact || 'Non-member guest', badge: 'Guest' }
  }
  if (b.player) return { name: titleCaseName(`${b.player.first_name ?? ''} ${b.player.last_name ?? ''}`.trim()), sub: b.player.email ?? '', badge: 'Invited' }
  return { name: titleCaseName(`${b.member?.first_name ?? ''} ${b.member?.last_name ?? ''}`.trim()), sub: b.member?.email ?? '' }
}

/**
 * Whether this row's money reached LinkUp.
 *
 * A round settled at the club is paid to the club — LinkUp never sees it, and a
 * club-only round is created 'payment_confirmed' because there is nothing for the
 * app to wait on (see PAY_AT_CLUB_BOOKING_STATUS). Counting either as revenue
 * here would report takings that were never taken, so the status alone isn't the
 * test: the payment method decides who was paid.
 */
function isLinkUpRevenue(b: BookingRow): boolean {
  if (b.payment_method === 'pay_at_club') return false
  return b.status === 'confirmed' || b.status === 'payment_confirmed'
}

// "Days left" badge for any unpaid player row — shown whenever the booking is
// still tentative or availability_confirmed, regardless of how far out the tee
// time is (past-due rows read "Overdue").
function paymentDaysLeftLabel(b: BookingRow): string | null {
  if (b.status !== 'tentative' && b.status !== 'availability_confirmed') return null
  // Being settled at the club — there's no online payment to count down to.
  if (b.payment_method === 'pay_at_club') return null
  const daysLeft = differenceInCalendarDays(new Date(`${b.booking_date}T12:00:00`), new Date())
  if (daysLeft < 0) return 'Overdue'
  if (daysLeft === 0) return 'Due today'
  if (daysLeft === 1) return '1 day left'
  return `${daysLeft} days left`
}

// ---- Tee-time card ---------------------------------------------------
//
// One tree per tee time, under its date: the time is the root and each booking
// a branch, drawn as a box. A member who booked alone is a box of one, and a
// group booking keeps its players together in one box, so who came with whom reads at a glance. Nothing
// collapses — an admin working a day needs every player, status and balance in
// view without opening each slot to find them.

type RowActions = {
  editingNote: string | null
  noteValues: Record<string, string>
  onEditNote: (id: string | null) => void
  onNoteChange: (id: string, val: string) => void
  onSaveNote: (id: string) => void
  savingNote: string | null
  noteRef: React.RefObject<HTMLTextAreaElement>
  deletingBookingId: string | null
  onRequestDelete: (b: BookingRow) => void
  onMove: (slot: TeeSlot) => void
}

function TeeTimeCard({ group, showCourseName, actions }: { group: TeeTimeGroup; showCourseName: boolean; actions: RowActions }) {
  const rows = group.slots.flatMap(s => s.rows)
  const activeRows = rows.filter(b => b.status !== 'cancelled')
  const paidCount = activeRows.filter(b => ['payment_confirmed', 'confirmed'].includes(b.status)).length
  const allPaid = activeRows.length > 0 && paidCount === activeRows.length
  const totalAmount = rows.reduce((sum, b) => sum + Number(b.amount_charged), 0)
  const hasAttention = rows.some(b => ['awaiting_approval', 'tentative'].includes(b.status))
  const courseName = rows[0]?.course?.name

  // Status breakdown for the slot header
  const statusBreakdown = rows.reduce<Record<string, number>>((acc, b) => {
    acc[b.status] = (acc[b.status] ?? 0) + 1
    return acc
  }, {})

  return (
    <div>
      {/* The tee time is the tree's root — no card around it, just the node. */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-stretch gap-2 min-w-0 flex-1">
          {/* Clock node, with the trunk starting beneath it */}
          <div className="flex flex-col items-center flex-shrink-0 w-6" aria-hidden="true">
            <span
              className="w-6 h-6 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(0,38,105,0.06)', color: 'var(--color-green-900)' }}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </span>
            <span className="flex-1 w-px bg-gray-200" />
          </div>
          <div className="min-w-0 flex-1">
            {/* Time + course + attention — first line */}
            <div className="flex items-center gap-2 flex-wrap min-h-6">
              <p className="text-sm font-semibold text-gray-800 whitespace-nowrap">{formatTeeTime(group.tee_time)}</p>
              {showCourseName && courseName && (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 whitespace-nowrap">
                  {courseName}
                </span>
              )}
              {hasAttention && (
                <span className="w-1.5 h-1.5 rounded-full bg-orange-400 flex-shrink-0" title="Needs attention" />
              )}
            </div>
            {/* Status chips — scrollable on mobile */}
            <div className="flex items-center gap-1 mt-0.5 overflow-x-auto pb-0.5 hide-scrollbar">
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

        {/* Amount + count */}
        <div className="flex-shrink-0 flex flex-wrap items-center justify-end gap-x-1.5 gap-y-1 text-right">
          <span className="text-xs font-semibold text-green-700">${totalAmount.toFixed(0)}</span>
          <span className="text-[10px] text-gray-400">· {rows.length}p</span>
          {activeRows.length > 0 && (
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap ${
              allPaid ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
            }`}>
              {allPaid ? '✓' : '⚠'} {paidCount}/{activeRows.length} paid
            </span>
          )}
        </div>
      </div>

      {/* Branches — one box per booking; the players booked together share a
          box. Each branch draws its own piece of the trunk, so the line stops
          at the last booking rather than running past it. */}
      <div>
        {group.slots.map((slot, si) => {
          const isLast = si === group.slots.length - 1
          return (
            <div key={slot.key} className="relative pl-6 pt-2">
              <span aria-hidden="true" className={`absolute left-3 top-0 w-px bg-gray-200 ${isLast ? 'h-7' : 'h-full'}`} />
              <span aria-hidden="true" className="absolute left-3 top-7 w-3 h-px bg-gray-200" />
              <div className="bg-white rounded-lg border border-gray-100 shadow-sm divide-y divide-gray-50">
                {slot.rows.map((b, i) => (
                  <PlayerRow key={b.id} b={b} slot={slot} isFirst={i === 0} inGroup={slot.rows.length > 1} actions={actions} />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Move is live on the first row of each box only, because it moves the whole
// booking — see POST /api/admin/bookings/[id]/move.
//
// No per-row price: within a tee time every seat costs the same, so the figure
// repeated down the list said nothing the slot's total above it doesn't. What
// can make one seat differ — credit put toward it, the booker covering it, the
// club collecting it — has its own chip.
function PlayerRow({ b, slot, isFirst, inGroup, actions }: { b: BookingRow; slot: TeeSlot; isFirst: boolean; inGroup: boolean; actions: RowActions }) {
  const {
    editingNote, noteValues, onEditNote, onNoteChange, onSaveNote,
    savingNote, noteRef, deletingBookingId, onRequestDelete, onMove,
  } = actions
  const info = playerInfo(b)
  const daysLeftLabel = paymentDaysLeftLabel(b)
  const atClub = settlingAtClub(b)
  const canMove = isFirst && slot.rows.some(r => r.status !== 'cancelled')
  // In a group the booker is worth naming; alone, they're the only one there.
  const badge = info.badge ?? (inGroup && isBookerRow(b) ? 'Booker' : undefined)
  const chip = 'text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 whitespace-nowrap'

  return (
    <div className="px-3 py-2.5">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className={`text-sm font-medium truncate ${b.status === 'cancelled' ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
              {info.name || info.sub}
            </p>
            {badge && <span className={`${chip} bg-gray-100 text-gray-500`}>{badge}</span>}
            {/* An added player's answer, and who's covering them. */}
            {b.invite_status && (
              <span className={`${chip} ${
                b.invite_status === 'accepted' ? 'bg-emerald-50 text-emerald-700'
                  : b.invite_status === 'declined' || b.invite_status === 'expired' ? 'bg-gray-100 text-gray-500'
                  : 'bg-yellow-50 text-yellow-700'
              }`}>
                {inviteStatusLabel(b.invite_status)}
              </span>
            )}
            {b.invite_status && (
              <span className={`${chip} bg-gray-100 text-gray-500`}>{b.paid_by_booker ? 'Booker pays' : 'Pays own'}</span>
            )}
            {daysLeftLabel && <span className={`${chip} bg-red-50 text-red-600`}>⏳ {daysLeftLabel}</span>}
            {/* The club collects this one. Amber rather than green: nothing
                tells us the member has paid them, so the badge doesn't say
                they have. */}
            {atClub && <span className={`${chip} bg-amber-50 text-amber-700`}>{PAY_AT_CLUB_LABEL}</span>}
            {/* Credit put toward this row. The code is shown because it's
                what a member quotes when they call about it. */}
            {b.credit_coupon && (
              <span className={`${chip} ${
                b.credit_coupon.status === 'void' || b.credit_coupon.status === 'expired'
                  ? 'bg-gray-100 text-gray-400'
                  : 'bg-amber-50 text-amber-700'
              }`}>
                🎟 ${b.credit_coupon.amount.toFixed(0)} · <span className="font-mono">{b.credit_coupon.code}</span> · {COUPON_STATUS_LABEL[b.credit_coupon.status]}
              </span>
            )}
            {b.dinner_rsvp && (
              <span className={`${chip} ${
                b.dinner_rsvp === 'yes'   ? 'bg-green-50 text-green-600' :
                b.dinner_rsvp === 'maybe' ? 'bg-yellow-50 text-yellow-600' :
                                            'bg-gray-100 text-gray-400'
              }`}>
                🍽 {b.dinner_rsvp === 'yes' ? 'Yes' : b.dinner_rsvp === 'no' ? 'No' : 'Maybe'}
              </span>
            )}
          </div>
          {info.name && info.sub && <p className="text-xs text-gray-400 mt-0.5 truncate">{info.sub}</p>}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 sm:flex-shrink-0 -ml-1.5 sm:ml-0">
          <button
            type="button"
            onClick={() => onEditNote(b.id)}
            title={b.admin_notes ? 'Edit note' : 'Add note'}
            aria-label={b.admin_notes ? 'Edit note' : 'Add note'}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
            </svg>
          </button>
          {/* On every row so the actions line up, but live only on the first:
              Move takes the whole booking with it, so a group's other players
              point back at the row that moves them. */}
          <button
            type="button"
            onClick={() => onMove(slot)}
            disabled={!canMove}
            title={canMove ? (inGroup ? 'Move this group' : 'Move booking') : isFirst ? 'Cancelled bookings can’t be moved' : 'Moves with the group — use Move on the first player'}
            aria-label={inGroup ? 'Move this group' : 'Move booking'}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-400 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => onRequestDelete(b)}
            disabled={deletingBookingId === b.id}
            title="Delete booking"
            aria-label={`Delete booking for ${info.name || 'player'}`}
            className="p-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
          </button>
        </div>
      </div>

      {/* Admin note — shown when there is one, editable in place. */}
      {editingNote === b.id ? (
        <div className="flex flex-col gap-1.5 mt-2">
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
      ) : b.admin_notes ? (
        <button
          type="button"
          onClick={() => onEditNote(b.id)}
          className="mt-1 w-full text-left text-xs italic text-gray-500 hover:text-gray-700 transition-colors break-words"
        >
          {b.admin_notes}
        </button>
      ) : null}
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
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('all')
  const [locationFilter, setLocationFilter] = useState<string>('all')
  const [tagFilter, setTagFilter] = useState<string>('all')
  const [eventNameFilter, setEventNameFilter] = useState('')
  const [debouncedEventName, setDebouncedEventName] = useState('')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [editingNote, setEditingNote] = useState<string | null>(null)
  const [noteValues, setNoteValues] = useState<Record<string, string>>({})
  const [savingNote, setSavingNote] = useState<string | null>(null)
  const [deletingBookingId, setDeletingBookingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<BookingRow | null>(null)
  const [moveTarget, setMoveTarget] = useState<TeeSlot | null>(null)
  const [showNewBooking, setShowNewBooking] = useState(false)
  const noteRef = useRef<HTMLTextAreaElement>(null)

  const [activeTab, setActiveTab] = useState<'bookings' | 'access'>('bookings')
  const [allMembers, setAllMembers] = useState<AccessMemberRow[]>([])
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [processingMemberId, setProcessingMemberId] = useState<string | null>(null)
  const [addMemberSearch, setAddMemberSearch] = useState('')

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
    // The window decides *which* bookings are fetched; the order they're shown
    // in is by tee date, latest first, with each date's own slots newest-booked
    // first (see groupByTeeTime).
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

    const SELECT = 'id, member_id, created_at, booking_date, tee_time, players, guest_name, player_member_id, additional_players, status, amount_charged, dinner_rsvp, admin_notes, payment_method, paid_by_booker, invite_status, ghl_opportunity_id, course_id, member:members!bookings_member_id_fkey(first_name, last_name, email), course:courses!bookings_course_id_fkey(name)'
    const SELECT_NO_DINNER = SELECT.replace('dinner_rsvp, ', '')

    function buildQuery(select: string) {
      let q = supabase
        .from('bookings')
        .select(select)
        .in('course_id', matchingCourseIds)
      if (rangeStart) q = q.gte('booking_date', rangeStart)
      if (rangeEnd) q = q.lte('booking_date', rangeEnd)
      // A round being paid at the club isn't waiting on an online payment.
      if (statusFilter === 'payment_overdue') q = q.eq('status', 'availability_confirmed').is('payment_method', null)
      else if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (dinnerFilter !== 'all') {
        q = dinnerFilter === 'none' ? q.is('dinner_rsvp', null) : q.eq('dinner_rsvp', dinnerFilter)
      }
      return q
        .order('created_at', { ascending: false })
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

    // Which of these were paid with credit. One query for the page rather than
    // an embed on the bookings select: credit_coupons has no FK PostgREST can
    // join from bookings, and most rows have no coupon at all.
    const couponMap = new Map<string, BookingCoupon>()
    const bookingIds = rows.map(b => b.id)
    if (bookingIds.length > 0) {
      const { data: coupons } = await supabase
        .from('credit_coupons')
        .select('id, code, amount, status, booking_id')
        .in('booking_id', bookingIds)
      for (const c of coupons ?? []) {
        if (c.booking_id) {
          couponMap.set(c.booking_id as string, {
            id: c.id as string,
            code: c.code as string,
            amount: Number(c.amount),
            status: c.status as BookingCoupon['status'],
          })
        }
      }
    }

    const enriched = rows.map(b => ({
      ...b,
      player: b.player_member_id ? (playerMap.get(b.player_member_id) ?? null) : null,
      credit_coupon: couponMap.get(b.id) ?? null,
    }))
    setBookings(enriched)
    const initial: Record<string, string> = {}
    enriched.forEach(b => { initial[b.id] = b.admin_notes ?? '' })
    setNoteValues(initial)
    setLoading(false)
  }, [view, courseFilter, locationFilter, tagFilter, debouncedEventName, statusFilter, dinnerFilter, customFrom, customTo])

  useEffect(() => { loadBookings() }, [loadBookings])
  useEffect(() => { if (editingNote && noteRef.current) noteRef.current.focus() }, [editingNote])

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

  // Both sides are free-text: the course's tags were picked by an admin, the
  // member's were mirrored from GHL. A case difference between them would show
  // a member as having no access to a course they can already book, inviting
  // an admin to re-grant a tag they hold.
  const membersWithAccess = useMemo(
    () => allMembers.filter(m => tagsOverlap(m.ghl_tags ?? [], courseAccessTags)),
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
  // loadBookings — free-text search (out of scope for server-side filtering,
  // see plan) and the payment method are re-checked here. Payment can't be a
  // server filter without a join: it's derived from the coupons fetched
  // alongside the rows.
  const filtered = useMemo(() => bookings.filter(b => {
    if (paymentFilter === 'credits' && !b.credit_coupon) return false
    if (paymentFilter === 'cash' && b.credit_coupon) return false
    const info = playerInfo(b)
    const q = search.toLowerCase()
    return !search || info.name.toLowerCase().includes(q) || info.sub.toLowerCase().includes(q)
  }), [bookings, search, paymentFilter])

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
  const hasActiveFilters = statusFilter !== 'all' || dinnerFilter !== 'all' || paymentFilter !== 'all'
    || locationFilter !== 'all' || tagFilter !== 'all' || !!eventNameFilter || !!search || !!customFrom || !!customTo

  // Count of active fields inside the mobile Filters drawer specifically
  // (excludes Search, which stays visible outside the drawer) — drives the
  // badge on the mobile "Filters" button.
  const activeFilterCount = [
    statusFilter !== 'all',
    dinnerFilter !== 'all',
    paymentFilter !== 'all',
    !!customFrom || !!customTo,
    locationFilter !== 'all',
    tagFilter !== 'all',
    !!eventNameFilter,
  ].filter(Boolean).length

  function clearFilters() {
    setSearch('')
    setStatusFilter('all')
    setDinnerFilter('all')
    setPaymentFilter('all')
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
  const allTeeTimes = useMemo(() => groupByTeeTime(allSlots), [allSlots])

  // Stats
  const confirmed  = bookings.filter(b => ['confirmed', 'payment_confirmed', 'availability_confirmed'].includes(b.status)).length
  const tentative  = bookings.filter(b => ['tentative', 'awaiting_approval'].includes(b.status)).length
  const revenue    = bookings.filter(isLinkUpRevenue).reduce((s, b) => s + Number(b.amount_charged), 0)
  const attention  = bookings.filter(b => b.status === 'awaiting_approval').length
  // Credit put toward these rounds. Void and expired codes are excluded — that
  // credit went back to the member and paid for nothing.
  const creditRows = bookings.filter(b => b.credit_coupon && b.credit_coupon.status !== 'void' && b.credit_coupon.status !== 'expired')
  const creditTotal = creditRows.reduce((s, b) => s + Number(b.credit_coupon?.amount ?? 0), 0)

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

  function exportCSV() {
    const headers = ['Course', 'Player', 'Email', 'Type', 'Date', 'Tee Time', 'Status', 'Payment', 'Credit code', 'Credit amount', 'Dinner RSVP', 'Admin Notes']
    const rows = filtered.map(b => {
      const info = playerInfo(b)
      const coupon = b.credit_coupon
      return [
        b.course?.name ?? '', info.name, info.sub, info.badge ?? 'Booker',
        b.booking_date, b.tee_time, b.status,
        coupon ? 'Credits' : 'Cash',
        coupon?.code ?? '',
        coupon ? coupon.amount.toFixed(2) : '',
        b.dinner_rsvp ?? '', b.admin_notes ?? '',
      ]
    })
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url; a.download = `bookings-${view}-${format(new Date(), 'yyyy-MM-dd')}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const rowActions: RowActions = {
    editingNote, noteValues,
    onEditNote: setEditingNote,
    onNoteChange: (id: string, val: string) => setNoteValues(prev => ({ ...prev, [id]: val })),
    onSaveNote: saveNote, savingNote, noteRef,
    deletingBookingId, onRequestDelete: setDeleteTarget,
    onMove: setMoveTarget,
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
        <FilterField label="Payment" htmlFor={`payment-${idSuffix}`}>
          <Select
            id={`payment-${idSuffix}`}
            value={paymentFilter}
            onChange={v => setPaymentFilter(v as PaymentFilter)}
            options={PAYMENT_FILTERS.map(p => ({ value: p, label: PAYMENT_FILTER_LABELS[p] }))}
            placeholder="Cash or credits"
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

      {showNewBooking && (
        <AdminNewBookingDrawer
          members={allMembers}
          defaultCourseId={courseFilter !== 'all' ? courseFilter : null}
          onClose={() => setShowNewBooking(false)}
          onBooked={msg => {
            setShowNewBooking(false)
            setRequestToast({ msg, ok: true })
            setTimeout(() => setRequestToast(null), 4000)
            loadBookings()
          }}
        />
      )}

      {moveTarget && (
        <MoveBookingModal
          slot={moveTarget}
          onClose={() => setMoveTarget(null)}
          onMoved={(msg, ok) => {
            setMoveTarget(null)
            setRequestToast({ msg, ok })
            setTimeout(() => setRequestToast(null), 4000)
            loadBookings()
          }}
        />
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
        <div className="flex flex-col sm:flex-row items-end sm:items-start gap-2 flex-shrink-0">
        <button
          type="button"
          onClick={() => setShowNewBooking(true)}
          className="px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-semibold rounded-[10px] bg-green-900 text-white hover:bg-green-800 transition-colors whitespace-nowrap"
        >
          + New booking
        </button>
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
        <StatCard label="Revenue"       value={`$${revenue.toLocaleString()}`} sub={creditTotal > 0 ? `Confirmed + payment · $${creditTotal.toLocaleString()} on credit` : 'Confirmed + payment'} colour="green" />
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
        /* All-courses view: grouped by course, then one card per date + tee time */
        <div className="space-y-8">
          {byCourse.map(({ course, bookings: cb }) => {
            const teeTimes = groupByTeeTime(groupBySlot(cb))
            const courseRevenue = cb.filter(isLinkUpRevenue).reduce((s, b) => s + Number(b.amount_charged), 0)
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

                <TeeTimeList groups={teeTimes} showCourseName={false} actions={rowActions} />
              </div>
            )
          })}
        </div>
      ) : (
        /* Single course / filtered view: one card per date + tee time */
        <TeeTimeList groups={allTeeTimes} showCourseName={courseList.length > 1} actions={rowActions} />
      )}

      {!loading && filtered.length > 0 && (
        <p className="text-xs text-gray-400 mt-5 text-right">
          {filtered.length} player{filtered.length !== 1 ? 's' : ''} · {allSlots.length} booking{allSlots.length !== 1 ? 's' : ''} · {allTeeTimes.length} tee time{allTeeTimes.length !== 1 ? 's' : ''} · {VIEW_LABELS[view].toLowerCase()}
        </p>
      )}
        </>
      )}
    </div>
  )
}

// ---- Date-grouped tee-time list --------------------------------------

function TeeTimeList({
  groups,
  showCourseName,
  actions,
}: {
  groups: TeeTimeGroup[]
  showCourseName: boolean
  actions: RowActions
}) {
  if (groups.length === 0) return null
  // groups arrive date-ordered (groupByTeeTime), so a date's tee times are adjacent.
  const dates: { date: string; isToday: boolean; teeTimes: TeeTimeGroup[] }[] = []
  for (const g of groups) {
    const last = dates[dates.length - 1]
    if (last?.date === g.booking_date) last.teeTimes.push(g)
    else dates.push({ date: g.booking_date, isToday: g.isToday, teeTimes: [g] })
  }
  return (
    <div className="space-y-4">
      {dates.map(dg => {
        const players = dg.teeTimes.reduce((s, t) => s + t.slots.reduce((n, sl) => n + sl.rows.length, 0), 0)
        return (
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
                {format(new Date(`${dg.date}T12:00:00`), 'EEEE, MMMM d, yyyy')}
                {dg.isToday && <span className="ml-0.5 font-bold">— Today</span>}
              </div>
              <div className="h-px flex-1 bg-gray-100" />
              <span className="text-[10px] text-gray-400">{players} player{players !== 1 ? 's' : ''}</span>
            </div>

            {/* Tee times for this date */}
            <div className="space-y-5 pl-1 pt-1">
              {dg.teeTimes.map(g => <TeeTimeCard key={g.key} group={g} showCourseName={showCourseName} actions={actions} />)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---- Move a booking group to another date ------------------------------

/**
 * Moves the whole tee-time group — booker and every player booked with them —
 * to another day, onto one of that day's open tee times (the same ones a member
 * booking is offered — see useVenueSlots). A time without room for the whole
 * group is shown but can't be picked. The server re-checks the slot, holds the
 * new day to the venue's cap, and moves each GHL appointment to match.
 */
function MoveBookingModal({
  slot,
  onClose,
  onMoved,
}: {
  slot: TeeSlot
  onClose: () => void
  onMoved: (msg: string, ok: boolean) => void
}) {
  const first = slot.rows[0]
  const [date, setDate] = useState(slot.booking_date)
  const [time, setTime] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const players = slot.rows.filter(b => b.status !== 'cancelled').length
  const currentTime = slot.tee_time.slice(0, 5)
  const { openSlots, loading, error: slotsError } = useVenueSlots(first?.course_id, date)

  // A tee time picked for one day means nothing on another.
  useEffect(() => { setTime('') }, [date])

  async function submit() {
    if (!first || !time) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/admin/bookings/${first.id}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, teeTime: time }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json.error ?? 'Failed to move the booking.'); return }
      const when = `${format(new Date(`${date}T12:00:00`), 'EEE, MMM d')} at ${formatTeeTime(`${time}:00`)}`
      onMoved(
        json.ghlFailed
          ? `Moved to ${when}, but ${json.ghlFailed} GHL appointment${json.ghlFailed === 1 ? '' : 's'} couldn't be updated.`
          : `Moved to ${when}. Players have been notified.`,
        !json.ghlFailed,
      )
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-5 max-h-[90vh] overflow-y-auto">
        <h2 className="text-sm font-bold text-gray-800">Move booking</h2>
        <p className="text-xs text-gray-500 mt-1">
          {first?.course?.name ? `${first.course.name} · ` : ''}
          {format(new Date(`${slot.booking_date}T12:00:00`), 'EEE, MMM d')} at {formatTeeTime(slot.tee_time)}
          {' · '}{players} player{players === 1 ? '' : 's'}. Everyone in this group moves together and is notified.
        </p>

        <label className="flex flex-col gap-1 mt-4">
          <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">New date</span>
          <input
            type="date"
            value={date}
            min={format(new Date(), 'yyyy-MM-dd')}
            onChange={e => setDate(e.target.value)}
            className="w-full px-2.5 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-900/20"
          />
        </label>

        <div className="mt-4">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Open tee times</p>
          {!date ? (
            <p className="text-xs text-gray-400">Pick a date first.</p>
          ) : loading ? (
            <p className="text-xs text-gray-400">Loading tee times…</p>
          ) : slotsError ? (
            <p className="text-xs text-red-600">{slotsError}</p>
          ) : openSlots.length === 0 ? (
            <p className="text-xs text-gray-500">No tee times open at this venue on this day.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {openSlots.map(s => {
                const hhmm = slotWallTime(s.startTime)
                const isCurrent = date === slot.booking_date && hhmm === currentTime
                const tooSmall = (s.spotsOpen ?? 0) < players
                const disabled = isCurrent || tooSmall
                return (
                  <button
                    key={s.startTime}
                    type="button"
                    disabled={disabled}
                    onClick={() => setTime(hhmm)}
                    title={isCurrent ? 'Already on this tee time' : tooSmall ? `Not enough room for ${players}` : undefined}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                      time === hhmm
                        ? 'bg-green-900 text-white border-green-900'
                        : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    {formatTeeTime(`${hhmm}:00`)}
                    <span className="font-normal opacity-70"> · {s.spotsOpen} open</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {error && <p className="text-xs text-red-600 mt-3">{error}</p>}

        <div className="flex gap-2 mt-5">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving || !date || !time}
            className="flex-1 py-2.5 rounded-xl bg-green-900 text-white text-sm font-semibold hover:bg-green-800 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Moving…' : 'Move booking'}
          </button>
        </div>
      </div>
    </div>
  )
}
