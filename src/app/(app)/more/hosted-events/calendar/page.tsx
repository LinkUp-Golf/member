'use client'

// Monthly calendar of member-hosted events: each day shows the venues with a
// LinkUp, and selecting a day lists that day's events to reserve.

import { useState, useEffect, useCallback, useMemo } from 'react'
import { startOfMonth, endOfMonth, addMonths, format, isSameMonth } from 'date-fns'
import { CalendarDays, ChevronRight } from 'lucide-react'
import AppShell from '@/components/layout/AppShell'
import { Spinner, CardSkeleton } from '@/components/ui/Loading'
import EventCalendar from '@/components/calendar/EventCalendar'
import HostedEventCard from '@/components/hosted-events/HostedEventCard'
import HostedEventsViewToggle from '@/components/hosted-events/ViewToggle'
import { eventTeeTimeSortKey } from '@/lib/utils'
import type { HostedEvent } from '@/types'

const iso = (d: Date) => format(d, 'yyyy-MM-dd')
const todayIso = () => format(new Date(), 'yyyy-MM-dd')

const fmtLongDate = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

export default function HostedEventsCalendarPage() {
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const [events, setEvents] = useState<HostedEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [venueFilter, setVenueFilter] = useState<string | null>(null)

  const load = useCallback(async (m: Date) => {
    setLoading(true)
    setError(null)
    // Drop the previous month's selection and filter up front: keeping them
    // would head the day panel with a date that isn't in the grid any more, and
    // point the filter at a venue that may not host next month.
    setSelectedDate(null)
    setVenueFilter(null)
    const from = iso(startOfMonth(m))
    const to = iso(endOfMonth(m))
    try {
      const res = await fetch(`/api/hosted-events?from=${from}&to=${to}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? 'Could not load the calendar.')
        setEvents([])
        return
      }
      const list = Array.isArray(json.events) ? (json.events as HostedEvent[]) : []
      setEvents(list)

      // Default the selection: today if it's in this month and has events,
      // otherwise the earliest day in the month that has one.
      const daysWithEvents = list.map(e => e.event_date.slice(0, 10)).sort()
      const t = todayIso()
      if (isSameMonth(m, new Date()) && daysWithEvents.includes(t)) setSelectedDate(t)
      else setSelectedDate(daysWithEvents[0] ?? null)
    } catch {
      setError('Could not load the calendar. Check your connection and try again.')
      setEvents([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(month) }, [month, load])

  const dayEvents = useMemo(() => {
    if (!selectedDate) return []
    return events
      .filter(e => e.event_date.slice(0, 10) === selectedDate)
      .filter(e => !venueFilter || e.course?.id === venueFilter)
      .sort((a, b) => eventTeeTimeSortKey(a.tee_time) - eventTeeTimeSortKey(b.tee_time))
  }, [events, selectedDate, venueFilter])

  const filteredVenueName = useMemo(
    () => events.find(e => e.course?.id === venueFilter)?.course?.name ?? null,
    [events, venueFilter],
  )

  const monthCount = useMemo(
    () => events.filter(e => !venueFilter || e.course?.id === venueFilter).length,
    [events, venueFilter],
  )

  const canGoPrev = month > startOfMonth(new Date())

  return (
    <AppShell title="Hosted Events" description="Browse by date">
      <div className="screen-content px-5 py-5">
        <HostedEventsViewToggle active="calendar" />

        {error ? (
          <div className="card card-pad text-center py-10">
            <p className="text-sm text-red-500">{error}</p>
            <button onClick={() => load(month)} className="btn btn-outline btn-sm mt-4">Try again</button>
          </div>
        ) : (
          <>
            <div className="relative">
              {loading && (
                <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-white/70">
                  <Spinner className="w-5 h-5 text-green-900" />
                </div>
              )}
              <EventCalendar
                month={month}
                events={events}
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
                onMonthChange={setMonth}
                canGoPrev={canGoPrev}
                venueFilter={venueFilter}
                onVenueFilterChange={setVenueFilter}
              />
            </div>

            <div className="mt-5">
              {loading ? (
                <div className="space-y-3" aria-hidden>
                  <CardSkeleton lines={3} />
                  <CardSkeleton lines={3} />
                </div>
              ) : selectedDate ? (
                <>
                  <div className="flex items-baseline justify-between gap-3 mb-2">
                    <h2 className="text-sm font-bold text-green-950">{fmtLongDate(selectedDate)}</h2>
                    {dayEvents.length > 0 && (
                      <span className="text-xs text-green-900/45 flex-shrink-0">
                        {dayEvents.length} LinkUp{dayEvents.length === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                  {dayEvents.length ? (
                    <div className="space-y-3">
                      {dayEvents.map(e => <HostedEventCard key={e.id} e={e} hideDate />)}
                    </div>
                  ) : (
                    <div className="card card-pad text-center py-8">
                      <p className="text-sm text-green-900/60">
                        {filteredVenueName
                          ? `No LinkUps at ${filteredVenueName} on this day.`
                          : 'No LinkUps on this day.'}
                      </p>
                      <p className="text-xs text-green-900/40 mt-1">
                        {monthCount > 0
                          ? 'Pick a highlighted day above.'
                          : 'Try another month.'}
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <div className="card card-pad text-center py-10">
                  <CalendarDays className="w-8 h-8 mx-auto text-green-900/30" strokeWidth={1.5} />
                  <p className="text-sm text-green-900/60 mt-3">No LinkUps in {format(month, 'MMMM')}.</p>
                  <p className="text-xs text-green-900/40 mt-1">Members host new rounds regularly — check the next month.</p>
                  <button
                    onClick={() => setMonth(addMonths(month, 1))}
                    className="btn btn-outline btn-sm mt-4 mx-auto"
                  >
                    {format(addMonths(month, 1), 'MMMM')}
                    <ChevronRight className="w-3.5 h-3.5" strokeWidth={2} />
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </AppShell>
  )
}
