'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuthStore } from '@/store/auth'
import { apiClient } from '@/lib/api-client'
import AppShell from '@/components/layout/AppShell'
import { Spinner } from '@/components/ui/Loading'
import { getBookingDates, formatTeeTime, cn } from '@/lib/utils'
import { format, isSameDay } from 'date-fns'
import type { Booking } from '@/types'

interface Slot {
  startTime: string
  endTime: string
  available: boolean
  spotsOpen: number
}

type Step = 'select' | 'confirm' | 'success'

export default function BookPage() {
  const { user } = useAuthStore()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [dates] = useState(() => getBookingDates())
  const [selectedDate, setSelectedDate] = useState<Date>(dates[0] ?? new Date())
  const [slots, setSlots] = useState<Slot[]>([])
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null)
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [step, setStep] = useState<Step>('select')
  const [guestName, setGuestName] = useState('')
  const [includeGuest, setIncludeGuest] = useState(false)
  const [booking, setBooking] = useState(false)
  const [error, setError] = useState('')
  const [confirmedBooking, setConfirmedBooking] = useState<{ date: string; time: string } | null>(null)
  const [myBookings, setMyBookings] = useState<Booking[]>([])
  const [activeTab, setActiveTab] = useState<'book' | 'myBookings'>('book')

  useEffect(() => {
    if (user) loadMyBookings()
  }, [user])

  useEffect(() => {
    if (selectedDate) loadSlots(selectedDate)
  }, [selectedDate])

  async function loadSlots(date: Date) {
    setLoadingSlots(true)
    setSelectedSlot(null)
    const dateStr = format(date, 'yyyy-MM-dd')
    try {
      const res = await fetch(`/api/bookings/create?date=${dateStr}`)
      const data = await res.json()
      setSlots(data.slots ?? [])
    } catch {
      setSlots([])
    }
    setLoadingSlots(false)
  }

  async function loadMyBookings() {
    const response = await apiClient.get<Booking[]>('/api/bookings')
    setMyBookings(response.data ?? [])
  }

  async function confirmBooking() {
    if (!selectedSlot || !user) return
    setBooking(true)
    setError('')

    const [datePart = '', timePart = ''] = selectedSlot.startTime.split('T')
    const timeStr = timePart.slice(0, 8)

    const res = await fetch('/api/bookings/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: datePart,
        teeTime: timeStr,
        players: includeGuest ? 2 : 1,
        guestName: includeGuest && guestName.trim() ? guestName.trim() : null,
      }),
    })

    const data = await res.json()

    if (res.ok) {
      setConfirmedBooking({
        date: format(selectedDate, 'EEEE, MMMM d'),
        time: formatTeeTime(timeStr),
      })
      setStep('success')
      loadMyBookings()
    } else {
      setError(data.error ?? 'Something went wrong. Please try again.')
    }
    setBooking(false)
  }

  if (step === 'success' && confirmedBooking) {
    return <SuccessScreen booking={confirmedBooking} onDone={() => { setStep('select'); setSelectedSlot(null) }} />
  }

  if (step === 'confirm' && selectedSlot) {
    return (
      <ConfirmScreen
        slot={selectedSlot}
        date={selectedDate}
        includeGuest={includeGuest}
        guestName={guestName}
        error={error}
        booking={booking}
        onToggleGuest={() => setIncludeGuest(v => !v)}
        onGuestName={setGuestName}
        onBack={() => setStep('select')}
        onConfirm={confirmBooking}
      />
    )
  }

  return (
    <AppShell title="Book" description="Park Hyatt Aviara">

      {/* Tabs */}
      <div className="flex border-b border-green-900/08 bg-white">
        {(['book', 'myBookings'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'flex-1 py-3 text-sm font-medium transition-colors border-b-2',
              activeTab === tab
                ? 'border-green-900 text-green-900'
                : 'border-transparent text-green-900/40'
            )}
          >
            {tab === 'book' ? 'Book a round' : 'My bookings'}
          </button>
        ))}
      </div>

      {activeTab === 'book' ? (
        <div className="pb-6">
          {/* Date picker */}
          <div className="px-5 pt-4 pb-2">
            <p className="section-label mb-3">Select a date</p>
            <div className="flex gap-2 overflow-x-auto hide-scrollbar pb-1">
              {dates.map(date => {
                const active = isSameDay(date, selectedDate)
                return (
                  <button
                    key={date.toISOString()}
                    onClick={() => setSelectedDate(date)}
                    className={cn(
                      'flex-shrink-0 flex flex-col items-center px-3 py-2.5 rounded-xl border min-w-[52px] transition-all',
                      active
                        ? 'bg-green-900 border-green-900'
                        : 'bg-white border-green-900/10'
                    )}
                  >
                    <span className={cn('text-xs uppercase tracking-wider', active ? 'text-gold' : 'text-green-900/40')}>
                      {format(date, 'EEE')}
                    </span>
                    <span className={cn('font-serif text-xl font-semibold mt-0.5', active ? 'text-white' : 'text-green-900')}>
                      {format(date, 'd')}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Tee times */}
          <div className="px-5 pt-3">
            <p className="section-label mb-3">
              Tee times — {format(selectedDate, 'EEE, MMM d')}
            </p>

            {loadingSlots ? (
              <div className="flex justify-center py-8">
                <Spinner className="text-green-700" />
              </div>
            ) : slots.length === 0 ? (
              <p className="text-sm text-green-900/40 italic text-center py-8">
                No tee times available for this date.
              </p>
            ) : (
              <div className="space-y-2">
                {/* Morning slots */}
                {slots.some(s => parseInt(s.startTime.split('T')[1] ?? '0') < 12) && (
                  <div className="divider-label mb-2">Morning</div>
                )}
                {slots.filter(s => {
                  const h = parseInt(s.startTime.split('T')[1]?.split(':')[0] ?? '0', 10)
                  return h < 12
                }).map((slot, i) => (
                  <SlotRow
                    key={i}
                    slot={slot}
                    selected={selectedSlot?.startTime === slot.startTime}
                    onSelect={() => setSelectedSlot(slot)}
                  />
                ))}

                {/* Afternoon slots */}
                {slots.some(s => parseInt(s.startTime.split('T')[1] ?? '0') >= 12) && (
                  <div className="divider-label mt-4 mb-2">Afternoon</div>
                )}
                {slots.filter(s => {
                  const h = parseInt(s.startTime.split('T')[1]?.split(':')[0] ?? '0', 10)
                  return h >= 12
                }).map((slot, i) => (
                  <SlotRow
                    key={i}
                    slot={slot}
                    selected={selectedSlot?.startTime === slot.startTime}
                    onSelect={() => setSelectedSlot(slot)}
                  />
                ))}
              </div>
            )}

            {/* Proceed button */}
            {selectedSlot && (
              <button
                onClick={() => setStep('confirm')}
                className="btn btn-gold btn-full mt-5"
              >
                Continue with {formatTeeTime(selectedSlot.startTime.split('T')[1]?.slice(0, 8) ?? '')} →
              </button>
            )}

            {/* Booking policy note */}
            <p className="text-xs text-green-900/30 text-center mt-4 leading-relaxed">
              Bookings open 3–60 days in advance · $160 per round<br />
              One non-member guest permitted per month
            </p>
          </div>
        </div>
      ) : (
        <MyBookingsTab bookings={myBookings} onRefresh={loadMyBookings} />
      )}
    </AppShell>
  )
}

// ---- Slot row -----------------------------------------------

function SlotRow({ slot, selected, onSelect }: { slot: Slot; selected: boolean; onSelect: () => void }) {
  const timeStr = slot.startTime.split('T')[1]?.slice(0, 8) ?? ''
  const full = !slot.available || slot.spotsOpen === 0

  return (
    <button
      onClick={full ? undefined : onSelect}
      disabled={full}
      className={cn(
        'w-full flex items-center justify-between px-4 py-3.5 rounded-xl border transition-all text-left',
        full
          ? 'bg-green-50/50 border-green-900/06 opacity-50 cursor-not-allowed'
          : selected
            ? 'bg-green-900/4 border-gold'
            : 'bg-white border-green-900/10 hover:border-green-900/25'
      )}
    >
      <div>
        <span className="font-serif text-xl font-semibold text-green-900">
          {formatTeeTime(timeStr)}
        </span>
        <p className="text-xs text-green-900/45 mt-0.5">18 holes · Member rate · $160</p>
      </div>
      <div className="text-right">
        {full ? (
          <span className="text-xs text-green-900/40">Full</span>
        ) : (
          <span className="text-xs font-medium" style={{ color: slot.spotsOpen <= 2 ? '#639948' : '#4A7A4A' }}>
            {slot.spotsOpen} spot{slot.spotsOpen !== 1 ? 's' : ''} open
          </span>
        )}
        {selected && (
          <div className="flex items-center justify-end gap-1 mt-1">
            <span className="text-xs" style={{ color: '#85bb65' }}>Selected ✓</span>
          </div>
        )}
      </div>
    </button>
  )
}

// ---- Confirmation screen ------------------------------------

function ConfirmScreen({
  slot, date, includeGuest, guestName, error, booking,
  onToggleGuest, onGuestName, onBack, onConfirm,
}: {
  slot: Slot
  date: Date
  includeGuest: boolean
  guestName: string
  error: string
  booking: boolean
  onToggleGuest: () => void
  onGuestName: (v: string) => void
  onBack: () => void
  onConfirm: () => void
}) {
  const timeStr = slot.startTime.split('T')[1]?.slice(0, 8) ?? ''

  return (
    <div>
      <div className="top-bar flex items-center gap-3">
        <button onClick={onBack} className="text-gold text-sm flex items-center gap-1">
          <BackArrow /> Back
        </button>
        <h1 className="flex-1 text-white font-medium text-sm text-center">Confirm Booking</h1>
        <div className="w-14" />
      </div>

      <div className="px-5 py-6 space-y-4">
        {/* Booking summary card */}
        <div className="card card-pad space-y-3">
          <p className="section-label">Booking details</p>
          <DetailRow label="Course" value="Park Hyatt Aviara" />
          <DetailRow label="Date" value={format(date, 'EEEE, MMMM d, yyyy')} />
          <DetailRow label="Tee time" value={formatTeeTime(timeStr)} />
          <DetailRow label="Players" value={includeGuest ? '2 (you + guest)' : '1 (you)'} />
          <div className="pt-2 border-t border-green-900/08 flex justify-between">
            <span className="text-sm font-medium text-green-900">Total</span>
            <span className="font-serif text-xl font-semibold text-green-900">$160.00</span>
          </div>
          <p className="text-xs text-green-900/40">
            Charged to your card on file. Cancellation policy applies.
          </p>
        </div>

        {/* Guest option */}
        <div className="card card-pad">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-green-900">Bring a guest</p>
              <p className="text-xs text-green-900/45 mt-0.5">One non-member guest per month at member rate</p>
            </div>
            <Toggle checked={includeGuest} onChange={onToggleGuest} />
          </div>
          {includeGuest && (
            <input
              type="text"
              placeholder="Guest name (required)"
              value={guestName}
              onChange={e => onGuestName(e.target.value)}
              className="input mt-3 text-sm"
              autoFocus
            />
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Confirm button */}
        <button
          onClick={onConfirm}
          disabled={booking || (includeGuest && !guestName.trim())}
          className="btn btn-gold btn-full mt-2"
        >
          {booking ? (
            <><Spinner className="w-4 h-4 text-green-900" /> Processing…</>
          ) : (
            'Confirm & pay $160'
          )}
        </button>

        <p className="text-xs text-green-900/30 text-center">
          Your community will be notified of your booking.
        </p>
      </div>
    </div>
  )
}

// ---- Success screen -----------------------------------------

function SuccessScreen({ booking, onDone }: { booking: { date: string; time: string }; onDone: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-8 text-center"
      style={{ background: '#F4F1E8' }}>
      <div className="text-6xl mb-5">⛳</div>
      <h1 className="font-serif text-3xl text-green-900 mb-2">You're booked!</h1>
      <p className="text-sm text-green-900/55 mb-1">
        {booking.date} at {booking.time}
      </p>
      <p className="text-sm text-green-900/55 mb-8">Park Hyatt Aviara</p>
      <p className="text-xs text-green-900/40 mb-8 leading-relaxed">
        Your community has been notified — fellow members can reach out to join your round.
      </p>
      <button onClick={onDone} className="btn btn-primary">
        Back to booking
      </button>
    </div>
  )
}

// ---- My bookings tab ----------------------------------------

function MyBookingsTab({ bookings, onRefresh }: { bookings: Booking[]; onRefresh: () => void }) {
  const [cancelling, setCancelling] = useState<string | null>(null)

  const upcoming = bookings.filter(b =>
    b.booking_date >= format(new Date(), 'yyyy-MM-dd') && b.status !== 'cancelled'
  )
  const past = bookings.filter(b =>
    b.booking_date < format(new Date(), 'yyyy-MM-dd')
  )

  async function cancelBooking(bookingId: string) {
    if (!confirm('Cancel this booking? This action cannot be undone.')) return
    setCancelling(bookingId)
    await apiClient.patch(`/api/bookings/${bookingId}`, {})
    onRefresh()
    setCancelling(null)
  }

  return (
    <div className="px-5 py-4 pb-8">
      {upcoming.length === 0 && past.length === 0 && (
        <p className="text-center text-sm text-green-900/40 italic py-8">
          No bookings yet. Book your first round above.
        </p>
      )}

      {upcoming.length > 0 && (
        <>
          <p className="section-label mb-3">Upcoming</p>
          <div className="space-y-2 mb-6">
            {upcoming.map(b => (
              <div key={b.id} className="card card-pad flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-green-900">
                    {format(new Date(b.booking_date + 'T12:00:00'), 'EEE, MMM d')}
                  </p>
                  <p className="text-xs text-green-900/50 mt-0.5">
                    {formatTeeTime(b.tee_time)} · ${b.amount_charged.toFixed(0)}
                    {b.guest_name ? ` · Guest: ${b.guest_name}` : ''}
                  </p>
                </div>
                <button
                  onClick={() => cancelBooking(b.id)}
                  disabled={cancelling === b.id}
                  className="text-xs text-red-400 flex-shrink-0"
                >
                  {cancelling === b.id ? <Spinner className="w-3 h-3 text-red-400" /> : 'Cancel'}
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {past.length > 0 && (
        <>
          <p className="section-label mb-3">Past rounds</p>
          <div className="space-y-2">
            {past.slice(0, 10).map(b => (
              <div key={b.id} className="card card-pad opacity-60">
                <p className="text-sm text-green-900">
                  {format(new Date(b.booking_date + 'T12:00:00'), 'EEE, MMM d, yyyy')}
                </p>
                <p className="text-xs text-green-900/50 mt-0.5">
                  {formatTeeTime(b.tee_time)}
                  {b.guest_name ? ` · Guest: ${b.guest_name}` : ''}
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ---- Shared sub-components ----------------------------------

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-start gap-4">
      <span className="text-xs text-green-900/45 flex-shrink-0">{label}</span>
      <span className="text-sm text-green-900 text-right">{value}</span>
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={cn(
        'w-11 h-6 rounded-full transition-colors flex-shrink-0 relative',
        checked ? 'bg-green-800' : 'bg-green-900/15'
      )}
      role="switch"
      aria-checked={checked}
    >
      <span className={cn(
        'absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform',
        checked ? 'translate-x-5' : 'translate-x-0.5'
      )} />
    </button>
  )
}

function BackArrow() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
    </svg>
  )
}
