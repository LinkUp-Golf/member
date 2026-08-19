'use client'

// Pick the days a host will put a round on, from what the venue actually has
// open.
//
// A host used to type a date and find out at approval time that the club had
// nothing that day. This asks the venue first: choose the course, and the month
// fills in with only the days it can take a round. Availability comes from the
// same helper as the member booking calendar, so the two can't disagree about
// whether a day is open.
//
// The count on each chip is not decoration: it's the capacity the event created
// for that date will carry, since a round is listed with the spots its venue
// actually has that day. Two dates at the same club routinely differ.

import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react'
import { addMonths, format, startOfMonth, isSameMonth } from 'date-fns'
import { cn } from '@/lib/utils'
import { Spinner } from '@/components/ui/Loading'

interface AvailableDate {
  date: string
  openSlots: number
  openSpots: number
}

const monthKey = (d: Date) => format(d, 'yyyy-MM')
// "Wed 19" reads as a date; "Wed, Aug 19" is used where the month isn't implied
// by the grid the chip sits in.
const dayLabel = (iso: string) => format(new Date(`${iso}T12:00:00`), 'EEE d')
const fullDayLabel = (iso: string) => format(new Date(`${iso}T12:00:00`), 'EEE, MMM d')

export default function VenueDateSelector({
  courseId,
  value,
  onChange,
  single = false,
  max,
  disabled = false,
}: {
  /** null until a venue is chosen — there is nothing to ask about before that. */
  courseId: string | null
  /** Selected dates, YYYY-MM-DD. */
  value: string[]
  onChange: (dates: string[]) => void
  /** Editing one existing event: picking a day replaces the selection. */
  single?: boolean
  /** Cap on how many days can be picked at once. */
  max?: number
  disabled?: boolean
}) {
  const [month, setMonth] = useState<Date>(() => startOfMonth(new Date()))
  const [dates, setDates] = useState<AvailableDate[] | null>(null)
  const [unconfigured, setUnconfigured] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!courseId) {
      setDates(null)
      setError(null)
      setUnconfigured(false)
      return
    }
    // Each month is a fan-out to the club's calendar, so a slower earlier month
    // can land after a newer one. Ignore all but the latest.
    let current = true
    setDates(null)
    setError(null)
    setUnconfigured(false)
    fetch(`/api/courses/${courseId}/available-dates?month=${monthKey(month)}`)
      .then(async r => {
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.error ?? 'Could not load dates.')
        return d
      })
      .then(d => {
        if (!current) return
        setDates(Array.isArray(d.dates) ? d.dates : [])
        setUnconfigured(d.unconfigured === true)
      })
      .catch((e: Error) => {
        if (!current) return
        setDates([])
        setError(e.message)
      })
    return () => {
      current = false
    }
  }, [courseId, month])

  const toggle = useCallback(
    (date: string) => {
      if (single) {
        onChange(value[0] === date ? [] : [date])
        return
      }
      if (value.includes(date)) {
        onChange(value.filter(d => d !== date))
        return
      }
      if (max && value.length >= max) return
      onChange([...value, date].sort())
    },
    [single, value, onChange, max],
  )

  // Days picked in other months stay selected but aren't on screen, so they're
  // listed back rather than silently carried.
  const offMonth = value.filter(d => !d.startsWith(monthKey(month))).sort()
  const atMax = !single && !!max && value.length >= max

  if (!courseId) {
    return (
      <p className="text-xs text-gray-400 rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center">
        Choose a venue first — its open dates will show here.
      </p>
    )
  }

  return (
    <div className="rounded-xl border border-gray-200">
      <div className="flex items-center justify-between px-2 py-2 border-b border-gray-100">
        <button
          type="button"
          onClick={() => setMonth(m => addMonths(m, -1))}
          disabled={disabled || isSameMonth(month, new Date())}
          aria-label="Previous month"
          className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:bg-gray-50 disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <ChevronLeft className="w-4 h-4" strokeWidth={2} />
        </button>
        <p aria-live="polite" className="text-xs font-semibold text-gray-700">
          {format(month, 'MMMM yyyy')}
        </p>
        <button
          type="button"
          onClick={() => setMonth(m => addMonths(m, 1))}
          disabled={disabled}
          aria-label="Next month"
          className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:bg-gray-50 disabled:opacity-30"
        >
          <ChevronRight className="w-4 h-4" strokeWidth={2} />
        </button>
      </div>

      <div className="px-3 py-3">
        {dates === null ? (
          <div className="flex justify-center py-6">
            <Spinner className="w-4 h-4 text-green-800" />
          </div>
        ) : error ? (
          <p className="text-xs text-red-600 py-4 text-center">{error}</p>
        ) : unconfigured ? (
          <p className="text-xs text-amber-600 py-4 text-center">
            This venue isn&apos;t set up for booking yet, so it has no open dates.
            The LinkUp team sets that up before rounds can be listed here.
          </p>
        ) : dates.length === 0 ? (
          <div className="py-4 text-center">
            <CalendarDays className="w-6 h-6 mx-auto text-gray-300" strokeWidth={1.5} />
            <p className="text-xs text-gray-500 mt-2">
              Nothing open at this venue in {format(month, 'MMMM')}.
            </p>
            <button
              type="button"
              onClick={() => setMonth(m => addMonths(m, 1))}
              className="mt-2 text-xs font-medium text-green-800 hover:text-green-900"
            >
              Try {format(addMonths(month, 1), 'MMMM')} →
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {dates.map(d => {
              const on = value.includes(d.date)
              // A day that would exceed the cap is shown but inert, so the limit
              // is visible rather than a tap that silently does nothing.
              const blocked = !on && (atMax || disabled)
              return (
                <button
                  key={d.date}
                  type="button"
                  aria-pressed={on}
                  disabled={blocked}
                  onClick={() => toggle(d.date)}
                  // The visible chip is deliberately short; the full picture —
                  // which is two different numbers — belongs here rather than
                  // crammed into it.
                  aria-label={`${fullDayLabel(d.date)} — ${d.openSpots} spot${
                    d.openSpots === 1 ? '' : 's'
                  }, across ${d.openSlots} tee time${d.openSlots === 1 ? '' : 's'}`}
                  title={`${d.openSpots} spot${d.openSpots === 1 ? '' : 's'} across ${d.openSlots} tee time${d.openSlots === 1 ? '' : 's'}`}
                  className={cn(
                    'flex flex-col items-start px-2.5 py-1.5 rounded-lg border transition-colors',
                    on
                      ? 'bg-green-800 border-green-800 text-white'
                      : blocked
                        ? 'bg-gray-50 border-gray-100 text-gray-300 cursor-not-allowed'
                        : 'bg-white border-gray-200 text-gray-700 hover:border-green-800 hover:text-green-900',
                  )}
                >
                  {/* Two lines, because a date and a count sitting side by side
                      read as one number soup ("Wed 19 3"). */}
                  <span className="text-xs font-semibold leading-tight">
                    {dayLabel(d.date)}
                  </span>
                  <span
                    className={cn(
                      'text-[10px] leading-tight',
                      on ? 'text-white/70' : 'text-gray-400',
                    )}
                  >
                    {d.openSpots} spot{d.openSpots === 1 ? '' : 's'}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {offMonth.length > 0 && (
          <div className="mt-3 pt-2 border-t border-gray-100">
            <p className="text-[11px] text-gray-400 mb-1.5">
              Also picked in other months
            </p>
            <div className="flex flex-wrap gap-1.5">
              {offMonth.map(d => (
                <button
                  key={d}
                  type="button"
                  disabled={disabled}
                  aria-label={`Remove ${fullDayLabel(d)}`}
                  onClick={() => onChange(value.filter(v => v !== d))}
                  className="px-2 py-1 rounded-lg border border-green-800/30 bg-green-50 text-[11px] font-medium text-green-900 hover:bg-green-100"
                >
                  {fullDayLabel(d)} ✕
                </button>
              ))}
            </div>
          </div>
        )}

        {atMax && (
          <p className="text-[11px] text-amber-600 mt-2">
            That&apos;s the most dates you can list at once ({max}).
          </p>
        )}
      </div>
    </div>
  )
}
