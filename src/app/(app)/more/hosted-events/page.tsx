'use client'

// Members browse upcoming member-hosted events and open one to reserve a spot.

import { useState, useEffect, useCallback, useMemo, memo } from 'react'
import Link from 'next/link'
import { CalendarDays, MapPin, Users } from 'lucide-react'
import AppShell from '@/components/layout/AppShell'
import { Spinner } from '@/components/ui/Loading'
import { memberPrice } from '@/lib/hosts/events'
import { formatEventTeeTime as fmtTime } from '@/lib/utils'
import type { HostedEvent } from '@/types'

const fmtMoney = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 })

const fmtDate = (d: string) =>
  new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

function hostLabel(e: HostedEvent) {
  const m = e.host?.member
  const person = m ? `${m.first_name} ${m.last_name}`.trim() : ''
  return e.host?.name || person || 'A member'
}

const EventCard = memo(function EventCard({ e }: { e: HostedEvent }) {
  const remaining = e.remaining_spots ?? 0
  const full = remaining <= 0
  // A reservation list can include events that are no longer open.
  const open = e.status === 'upcoming'

  return (
    <Link href={`/more/hosted-events/${e.id}`} className="card card-pad block hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-green-950">{e.course?.name ?? 'Course'}</p>
          <p className="text-xs text-green-900/50 mt-1 flex items-center gap-1">
            <CalendarDays className="w-3.5 h-3.5" strokeWidth={1.75} />
            {fmtDate(e.event_date)}{e.tee_time ? ` · ${fmtTime(e.tee_time)}` : ''}
          </p>
          {e.course?.city && (
            <p className="text-xs text-green-900/50 mt-0.5 flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5" strokeWidth={1.75} />
              {e.course.city}
            </p>
          )}
          {e.dinner && <p className="text-xs text-green-800 mt-0.5 font-medium">🍽 Dinner included</p>}
          <p className="text-xs text-green-900/40 mt-1">Hosted by {hostLabel(e)}</p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-sm font-bold text-green-950">{fmtMoney(e.member_price ?? memberPrice(e.member_guest_rate))}</p>
          <p className="text-[11px] text-green-900/40">per member</p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-green-900/55 flex items-center gap-1">
          <Users className="w-3.5 h-3.5" strokeWidth={1.75} />
          {!open ? (e.status === 'cancelled' ? 'Cancelled' : 'Finished') : full ? 'Full' : `${remaining} spot${remaining === 1 ? '' : 's'} left`}
        </span>
        {e.is_registered ? (
          <span className="text-xs font-medium text-green-700">You&apos;re in ✓</span>
        ) : !open ? (
          <span className="text-xs text-green-900/40">Closed</span>
        ) : full ? (
          <span className="text-xs text-green-900/40">Waitlist unavailable</span>
        ) : (
          <span className="text-xs font-medium text-green-800">Reserve →</span>
        )}
      </div>
    </Link>
  )
})

export default function HostedEventsPage() {
  const [events, setEvents] = useState<HostedEvent[]>([])
  const [mine, setMine] = useState<HostedEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [browseRes, mineRes] = await Promise.all([
        fetch('/api/hosted-events'),
        fetch('/api/hosted-events?mine=1'),
      ])
      const browseJson = await browseRes.json().catch(() => ({}))
      const mineJson = await mineRes.json().catch(() => ({}))

      if (!browseRes.ok) {
        // An empty list and a failed load look identical otherwise.
        setError(browseJson.error ?? 'Could not load hosted events.')
      } else {
        setError(null)
        setEvents(Array.isArray(browseJson.events) ? browseJson.events : [])
      }
      if (mineRes.ok) setMine(Array.isArray(mineJson.events) ? mineJson.events : [])
    } catch {
      setError('Could not load hosted events. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Don't repeat an event the member already holds a spot in.
  const browsable = useMemo(() => {
    const mineIds = new Set(mine.map(e => e.id))
    return events.filter(e => !mineIds.has(e.id))
  }, [events, mine])

  return (
    <AppShell title="Hosted Events" description="Rounds hosted by fellow members">
      <div className="screen-content px-5 py-5">
        {loading ? (
          <div className="py-16 flex justify-center"><Spinner className="w-5 h-5 text-green-900" /></div>
        ) : error ? (
          <div className="card card-pad text-center py-10">
            <p className="text-sm text-red-500">{error}</p>
            <button onClick={() => { setLoading(true); load() }} className="btn btn-outline btn-sm mt-4">Try again</button>
          </div>
        ) : (
          <>
            {mine.length > 0 && (
              <div className="mb-6">
                <p className="section-label mb-2">Your reservations</p>
                <div className="space-y-3">
                  {mine.map(e => <EventCard key={e.id} e={e} />)}
                </div>
              </div>
            )}

            {mine.length > 0 && browsable.length > 0 && (
              <p className="section-label mb-2">More events</p>
            )}

            {browsable.length === 0 ? (
              mine.length === 0 && (
                <div className="card card-pad text-center py-10">
                  <CalendarDays className="w-8 h-8 mx-auto text-green-900/30" strokeWidth={1.5} />
                  <p className="text-sm text-green-900/60 mt-3">No hosted events right now.</p>
                  <p className="text-xs text-green-900/40 mt-1">Check back soon — members host new rounds regularly.</p>
                </div>
              )
            ) : (
              <div className="space-y-3">
                {browsable.map(e => <EventCard key={e.id} e={e} />)}
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  )
}
