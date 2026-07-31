'use client'

// Members browse upcoming member-hosted events and open one to reserve a spot.

import { useState, useEffect, useCallback, useMemo } from 'react'
import { CalendarDays } from 'lucide-react'
import AppShell from '@/components/layout/AppShell'
import { Spinner } from '@/components/ui/Loading'
import HostedEventCard from '@/components/hosted-events/HostedEventCard'
import HostedEventsViewToggle from '@/components/hosted-events/ViewToggle'
import { eventTeeTimeSortKey } from '@/lib/utils'
import type { HostedEvent } from '@/types'

const day = (e: HostedEvent) => e.event_date.slice(0, 10)

// The API orders by date only, so same-day events arrive in an arbitrary order.
const byDateThenTeeTime = (a: HostedEvent, b: HostedEvent) =>
  day(a).localeCompare(day(b)) || eventTeeTimeSortKey(a.tee_time) - eventTeeTimeSortKey(b.tee_time)

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
    return events.filter(e => !mineIds.has(e.id)).sort(byDateThenTeeTime)
  }, [events, mine])

  // ?mine=1 returns every reservation the member holds — including rounds that
  // have already run or been cancelled — ordered oldest first. Lead with what
  // they can still turn up to.
  const myReservations = useMemo(() => {
    const upcoming = mine.filter(e => e.status === 'upcoming').sort(byDateThenTeeTime)
    const past = mine.filter(e => e.status !== 'upcoming').sort((a, b) => byDateThenTeeTime(b, a))
    return [...upcoming, ...past]
  }, [mine])

  return (
    <AppShell title="Hosted Events" description="Rounds hosted by fellow members">
      <div className="screen-content px-5 py-5">
        <HostedEventsViewToggle active="list" />

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
                  {myReservations.map(e => <HostedEventCard key={e.id} e={e} />)}
                </div>
              </div>
            )}

            {browsable.length > 0 && (
              <p className="section-label mb-2">{mine.length > 0 ? 'More events' : 'Upcoming events'}</p>
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
                {browsable.map(e => <HostedEventCard key={e.id} e={e} />)}
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  )
}
