'use client'

// Hosted event detail — host info, pricing, availability, and reserve/cancel.

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { CalendarDays, Clock, MapPin, Users, ChevronLeft } from 'lucide-react'
import AppShell from '@/components/layout/AppShell'
import { Spinner } from '@/components/ui/Loading'
import { memberPrice } from '@/lib/hosts/events'
import { formatEventTeeTime as fmtTime } from '@/lib/utils'
import type { HostedEvent } from '@/types'

const fmtMoney = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 })

const fmtDate = (d: string) =>
  new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

function hostLabel(e: HostedEvent) {
  const m = e.host?.member
  const person = m ? `${m.first_name} ${m.last_name}`.trim() : ''
  return e.host?.name || person || 'A member'
}

export default function HostedEventDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = String(params?.id ?? '')

  const [event, setEvent] = useState<HostedEvent | null>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmingCancel, setConfirmingCancel] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/hosted-events/${id}`)
    const json = await res.json().catch(() => ({}))
    if (res.ok) setEvent(json.event)
    else setError(json.error ?? 'Could not load this event.')
    setLoading(false)
  }, [id])

  useEffect(() => { if (id) load() }, [id, load])

  async function reserve() {
    if (working) return
    setWorking(true); setError(null); setNotice(null)
    const res = await fetch(`/api/hosted-events/${id}/register`, { method: 'POST' })
    const json = await res.json().catch(() => ({}))
    setWorking(false)
    if (!res.ok) { setError(json.error ?? 'Could not reserve a spot.'); return }
    setNotice('Your spot is reserved.')
    load()
  }

  async function cancel() {
    if (working) return
    setWorking(true); setError(null); setNotice(null)
    const res = await fetch(`/api/hosted-events/${id}/register`, { method: 'DELETE' })
    const json = await res.json().catch(() => ({}))
    setWorking(false)
    setConfirmingCancel(false)
    if (!res.ok) { setError(json.error ?? 'Could not cancel your spot.'); return }
    setNotice('Your spot has been released.')
    load()
  }

  const remaining = event?.remaining_spots ?? 0
  const full = remaining <= 0
  const registered = !!event?.is_registered
  // Only a live event is joinable. A shared link to a cancelled/finished event
  // must not render a Reserve button that's guaranteed to fail server-side.
  const isOpen = event?.status === 'upcoming'
  const closedNotice =
    event?.status === 'cancelled'
      ? event.cancellation_reason
        ? `This event was cancelled. ${event.cancellation_reason}`
        : 'This event was cancelled.'
      : event && !isOpen
        ? 'This event has already taken place.'
        : null

  return (
    <AppShell title="Hosted Event" description="Reserve your spot">
      <div className="screen-content px-5 py-5">
        <button onClick={() => router.push('/more/hosted-events')} className="text-xs text-green-900/50 hover:text-green-900 flex items-center gap-1 mb-4">
          <ChevronLeft className="w-4 h-4" /> All hosted events
        </button>

        {loading ? (
          <div className="py-16 flex justify-center"><Spinner className="w-5 h-5 text-green-900" /></div>
        ) : !event ? (
          <div className="card card-pad text-center py-10">
            <p className="text-sm text-red-500">{error ?? 'Event not found.'}</p>
          </div>
        ) : (
          <>
            <div className="card card-pad space-y-4">
              <div>
                <h1 className="text-lg font-bold text-green-950">{event.course?.name ?? 'Course'}</h1>
                <p className="text-xs text-green-900/45 mt-1">Hosted by {hostLabel(event)}</p>
              </div>

              <div className="space-y-2 text-sm text-green-900/75">
                <p className="flex items-center gap-2"><CalendarDays className="w-4 h-4 text-green-900/40" strokeWidth={1.75} />{fmtDate(event.event_date)}</p>
                {event.tee_time && <p className="flex items-center gap-2"><Clock className="w-4 h-4 text-green-900/40" strokeWidth={1.75} />{fmtTime(event.tee_time)}</p>}
                {event.course?.city && <p className="flex items-center gap-2"><MapPin className="w-4 h-4 text-green-900/40" strokeWidth={1.75} />{event.course.city}</p>}
                <p className="flex items-center gap-2"><Users className="w-4 h-4 text-green-900/40" strokeWidth={1.75} />{full ? 'Full' : `${remaining} of ${event.total_spots} spots left`}</p>
              </div>

              {event.description && (
                <p className="text-sm text-green-900/70 leading-relaxed whitespace-pre-wrap border-t border-green-900/5 pt-4">{event.description}</p>
              )}

              <div className="border-t border-green-900/5 pt-4">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-green-900/60">Member price</span>
                  <span className="text-xl font-bold text-green-950">{fmtMoney(event.member_price ?? memberPrice(event.member_guest_rate))}</span>
                </div>
              </div>
            </div>

            {closedNotice && (
              <div className="card card-pad mt-4 bg-gray-50 border-gray-200">
                <p className="text-sm text-green-900/70">{closedNotice}</p>
              </div>
            )}

            {error && <p className="text-sm text-red-500 mt-4 text-center">{error}</p>}
            {notice && <p className="text-sm text-green-700 mt-4 text-center">{notice}</p>}

            {/* Set the money expectation before they commit, not after. */}
            {isOpen && !registered && !full && (
              <p className="text-xs text-green-900/50 text-center mt-5">
                You won&apos;t be charged now — you&apos;ll settle {fmtMoney(event.member_price ?? memberPrice(event.member_guest_rate))} directly with the host.
              </p>
            )}

            {isOpen && (
              <div className="mt-3">
                {registered ? (
                  confirmingCancel ? (
                    <div className="card card-pad space-y-3">
                      <p className="text-sm text-green-900/75">
                        Release your spot? It may be taken by someone else — there&apos;s no waitlist.
                      </p>
                      <div className="flex gap-2">
                        <button onClick={() => setConfirmingCancel(false)} disabled={working} className="btn btn-outline btn-sm flex-1 justify-center">Keep my spot</button>
                        <button onClick={cancel} disabled={working} className="btn btn-sm flex-1 justify-center bg-red-600 text-white">
                          {working ? <Spinner className="w-4 h-4" /> : 'Release it'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmingCancel(true)} disabled={working} className="btn btn-outline btn-full justify-center text-red-600 border-red-200">
                      Cancel my spot
                    </button>
                  )
                ) : full ? (
                  <button disabled className="btn btn-full justify-center bg-gray-100 text-gray-400 cursor-not-allowed">Event is full</button>
                ) : (
                  <button onClick={reserve} disabled={working} className="btn btn-gold btn-full justify-center">
                    {working ? <Spinner className="w-4 h-4 text-green-900" /> : `Reserve my spot · ${fmtMoney(event.member_price ?? memberPrice(event.member_guest_rate))}`}
                  </button>
                )}
              </div>
            )}
            {registered && (
              <p className="text-xs text-green-900/45 text-center mt-3">You have a spot at this event. Payment is arranged with the host.</p>
            )}
          </>
        )}
      </div>
    </AppShell>
  )
}
