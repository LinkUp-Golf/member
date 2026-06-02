'use client'

import { useState, useEffect } from 'react'
import { useProfile } from '@/hooks/useProfile'
import { apiClient } from '@/lib/api-client'
import AppShell from '@/components/layout/AppShell'
import { Spinner } from '@/components/ui/Loading'
import EmptyState from '@/components/ui/EmptyState'
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
  const { user } = useProfile()

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
        onConfirm={confirmBooking}
      />
    )
  }

  return (
    <AppShell title="Book" description="Park Hyatt Aviara">

      {/* Tabs */}
      <div className="flex border-b bg-white" style={{ borderColor: 'rgba(0,38,105,0.07)' }}>
        {(['book', 'myBookings'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'flex-1 py-3.5 text-sm font-medium transition-all border-b-2',
              activeTab === tab
                ? 'border-green-900 text-green-900'
                : 'border-transparent'
            )}
            style={{ color: activeTab === tab ? 'var(--color-green-900)' : 'rgba(0,38,105,0.35)' }}
          >
            {tab === 'book' ? 'Book a round' : 'My bookings'}
          </button>
        ))}
      </div>

      {activeTab === 'book' ? (
        <div className="pb-8">
          {/* Date picker */}
          <div className="px-5 pt-5 pb-3">
            <p className="section-label mb-3">Select a date</p>
            <div className="flex gap-2 overflow-x-auto hide-scrollbar pb-1">
              {dates.map(date => {
                const active = isSameDay(date, selectedDate)
                return (
                  <button
                    key={date.toISOString()}
                    onClick={() => setSelectedDate(date)}
                    className={cn(
                      'flex-shrink-0 flex flex-col items-center px-3 py-3 rounded-2xl border min-w-[56px] transition-all duration-150',
                      active
                        ? 'border-green-900'
                        : 'bg-white border-green-900/08'
                    )}
                    style={active ? { background: 'var(--color-green-900)' } : {}}
                  >
                    <span className="text-[10px] uppercase tracking-wider font-medium"
                      style={{ color: active ? 'rgba(133,187,101,0.8)' : 'rgba(0,38,105,0.38)' }}>
                      {format(date, 'EEE')}
                    </span>
                    <span className="font-sans font-black text-2xl mt-0.5"
                      style={{ color: active ? 'white' : 'var(--color-green-900)' }}>
                      {format(date, 'd')}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Tee times */}
          <div className="px-5 pt-2">
            <p className="section-label mb-3">
              Tee times — {format(selectedDate, 'EEE, MMM d')}
            </p>

            {loadingSlots ? (
              <div className="flex justify-center py-10">
                <Spinner className="text-green-700" />
              </div>
            ) : slots.length === 0 ? (
              <div className="py-4">
                <EmptyState icon="⛳" title="No tee times available" description="There are no open slots for this date. Try another day." />
              </div>
            ) : (
              <div className="space-y-2">
                {slots.some(s => parseInt(s.startTime.split('T')[1] ?? '0') < 12) && (
                  <div className="divider-label mb-1">Morning</div>
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

                {slots.some(s => parseInt(s.startTime.split('T')[1] ?? '0') >= 12) && (
                  <div className="divider-label mt-4 mb-1">Afternoon</div>
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
                className="btn btn-gold btn-full mt-6"
              >
                Continue — {formatTeeTime(selectedSlot.startTime.split('T')[1]?.slice(0, 8) ?? '')} →
              </button>
            )}

            <p className="text-xs text-center mt-5 leading-relaxed" style={{ color: 'rgba(0,38,105,0.28)' }}>
              Bookings open 3–60 days in advance · $160 per round
              <br />
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
        'w-full flex items-center justify-between px-5 py-4 rounded-2xl border transition-all duration-150 text-left',
        full
          ? 'opacity-45 cursor-not-allowed'
          : selected
            ? ''
            : 'bg-white hover:border-green-900/20'
      )}
      style={
        full
          ? { background: 'rgba(0,38,105,0.03)', borderColor: 'rgba(0,38,105,0.06)' }
          : selected
            ? { background: 'rgba(133,187,101,0.06)', borderColor: 'var(--color-gold)', boxShadow: '0 0 0 1px var(--color-gold)' }
            : { borderColor: 'rgba(0,38,105,0.09)' }
      }
    >
      <div>
        <span className="font-sans font-black text-2xl" style={{ color: 'var(--color-green-900)' }}>
          {formatTeeTime(timeStr)}
        </span>
        <p className="text-xs mt-0.5" style={{ color: 'rgba(0,38,105,0.42)' }}>
          18 holes · Member rate · $160
        </p>
      </div>
      <div className="text-right">
        {full ? (
          <span className="text-xs" style={{ color: 'rgba(0,38,105,0.35)' }}>Full</span>
        ) : selected ? (
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium" style={{ color: 'var(--color-gold-dark)' }}>Selected</span>
            <div className="w-4 h-4 rounded-full flex items-center justify-center"
              style={{ background: 'var(--color-gold)' }}>
              <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
          </div>
        ) : (
          <span className="text-xs font-medium" style={{ color: slot.spotsOpen <= 2 ? '#639948' : 'rgba(0,38,105,0.5)' }}>
            {slot.spotsOpen} spot{slot.spotsOpen !== 1 ? 's' : ''} open
          </span>
        )}
      </div>
    </button>
  )
}

// ---- Confirmation screen ------------------------------------

function ConfirmScreen({
  slot, date, includeGuest, guestName, error, booking,
  onToggleGuest, onGuestName, onConfirm,
}: {
  slot: Slot
  date: Date
  includeGuest: boolean
  guestName: string
  error: string
  booking: boolean
  onToggleGuest: () => void
  onGuestName: (v: string) => void
  onConfirm: () => void
}) {
  const timeStr = slot.startTime.split('T')[1]?.slice(0, 8) ?? ''

  return (
    <div>
      <div className="top-bar flex items-center justify-between">
        <h1 className="text-sm font-medium" style={{ color: 'white' }}>
          Confirm Booking
        </h1>
      </div>

      <div className="px-5 py-6 space-y-4">
        {/* Booking summary card */}
        <div className="card p-5 space-y-3.5">
          <p className="section-label !mb-0">Booking details</p>
          <div className="space-y-3 pt-1">
            <DetailRow label="Course" value="Park Hyatt Aviara" />
            <DetailRow label="Date" value={format(date, 'EEEE, MMMM d, yyyy')} />
            <DetailRow label="Tee time" value={formatTeeTime(timeStr)} />
            <DetailRow label="Players" value={includeGuest ? '2 (you + guest)' : '1 (you)'} />
          </div>
          <div className="pt-3 border-t flex justify-between items-center"
            style={{ borderColor: 'rgba(0,38,105,0.07)' }}>
            <span className="text-sm font-medium" style={{ color: 'var(--color-green-900)' }}>Total</span>
            <span className="font-sans font-black text-2xl" style={{ color: 'var(--color-green-900)' }}>
              $160
            </span>
          </div>
          <p className="text-xs" style={{ color: 'rgba(0,38,105,0.35)' }}>
            Charged to your card on file. Cancellation policy applies.
          </p>
        </div>

        {/* Guest option */}
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-green-900)' }}>Bring a guest</p>
              <p className="text-xs mt-0.5" style={{ color: 'rgba(0,38,105,0.42)' }}>
                One non-member guest per month at member rate
              </p>
            </div>
            <Toggle checked={includeGuest} onChange={onToggleGuest} />
          </div>
          {includeGuest && (
            <input
              type="text"
              placeholder="Guest name (required)"
              value={guestName}
              onChange={e => onGuestName(e.target.value)}
              className="input mt-4"
              autoFocus
            />
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-2xl border px-5 py-4"
            style={{ background: 'rgba(239,68,68,0.05)', borderColor: 'rgba(239,68,68,0.15)' }}>
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {/* Confirm button */}
        <button
          onClick={onConfirm}
          disabled={booking || (includeGuest && !guestName.trim())}
          className="btn btn-gold btn-full mt-2 disabled:opacity-50"
        >
          {booking ? (
            <><Spinner className="w-4 h-4 text-green-900" /> Processing…</>
          ) : (
            'Confirm & pay $160'
          )}
        </button>

        <p className="text-xs text-center" style={{ color: 'rgba(0,38,105,0.28)' }}>
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
      style={{ background: 'var(--color-cream)' }}>
      <div className="w-20 h-20 rounded-3xl flex items-center justify-center text-4xl mb-6 mx-auto"
        style={{ background: 'rgba(133,187,101,0.12)', border: '1px solid rgba(133,187,101,0.2)' }}>
        ⛳
      </div>
      <h1 className="font-sans font-black mb-2" style={{ fontSize: '2rem', color: 'var(--color-green-900)' }}>
        You&apos;re booked!
      </h1>
      <p className="text-sm mb-1" style={{ color: 'rgba(0,38,105,0.5)' }}>
        {booking.date} at {booking.time}
      </p>
      <p className="text-sm mb-8" style={{ color: 'rgba(0,38,105,0.5)' }}>
        Park Hyatt Aviara
      </p>
      <div className="card p-5 w-full max-w-sm mb-8 text-left">
        <p className="text-xs uppercase tracking-widest mb-2" style={{ color: 'rgba(0,38,105,0.35)', letterSpacing: '0.14em' }}>
          What&apos;s next
        </p>
        <p className="text-sm leading-relaxed" style={{ color: 'rgba(0,38,105,0.6)' }}>
          Your community has been notified — fellow members can reach out to join your round.
        </p>
      </div>
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
    <div className="px-5 py-5 pb-8">
      {upcoming.length === 0 && past.length === 0 && (
        <EmptyState icon="🗓️" title="No bookings yet" description="Book your first round using the tee time selector above." />
      )}

      {upcoming.length > 0 && (
        <>
          <p className="section-label mb-3">Upcoming</p>
          <div className="space-y-2.5 mb-7">
            {upcoming.map(b => (
              <div key={b.id} className="card p-5 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium" style={{ color: 'var(--color-green-900)' }}>
                    {format(new Date(b.booking_date + 'T12:00:00'), 'EEE, MMM d')}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'rgba(0,38,105,0.45)' }}>
                    {formatTeeTime(b.tee_time)} · ${b.amount_charged.toFixed(0)}
                    {b.guest_name ? ` · Guest: ${b.guest_name}` : ''}
                  </p>
                </div>
                <button
                  onClick={() => cancelBooking(b.id)}
                  disabled={cancelling === b.id}
                  className="text-xs flex-shrink-0 py-1 px-2.5 rounded-lg border transition-colors"
                  style={{ color: 'rgba(220,38,38,0.7)', borderColor: 'rgba(220,38,38,0.15)', background: 'rgba(220,38,38,0.04)' }}
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
              <div key={b.id} className="card p-4" style={{ opacity: 0.55 }}>
                <p className="text-sm" style={{ color: 'var(--color-green-900)' }}>
                  {format(new Date(b.booking_date + 'T12:00:00'), 'EEE, MMM d, yyyy')}
                </p>
                <p className="text-xs mt-0.5" style={{ color: 'rgba(0,38,105,0.5)' }}>
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
      <span className="text-xs flex-shrink-0" style={{ color: 'rgba(0,38,105,0.42)' }}>{label}</span>
      <span className="text-sm text-right" style={{ color: 'var(--color-green-900)' }}>{value}</span>
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className="w-12 h-6 rounded-full transition-all duration-200 flex-shrink-0 relative"
      style={{
        background: checked ? 'var(--color-green-700)' : 'rgba(0,38,105,0.12)',
        boxShadow: checked ? 'inset 0 1px 3px rgba(0,0,0,0.15)' : 'none',
      }}
      role="switch"
      aria-checked={checked}
    >
      <span className={cn(
        'absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200',
        checked ? 'translate-x-6' : 'translate-x-0.5'
      )} />
    </button>
  )
}

