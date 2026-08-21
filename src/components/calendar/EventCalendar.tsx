'use client'

import { memo, useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  addDays, addMonths, format, isSameMonth, isToday,
} from 'date-fns'
import { cn } from '@/lib/utils'
import {
  VENUE_DOT as DOT,
  VENUE_TEXT as TEXT,
  VENUE_COLOUR_COUNT,
} from '@/components/calendar/venue-colours'
import type { HostedEvent } from '@/types'

const WEEKDAYS = [
  ['Sun', 'S'], ['Mon', 'M'], ['Tue', 'T'], ['Wed', 'W'],
  ['Thu', 'T'], ['Fri', 'F'], ['Sat', 'S'],
] as const

const iso = (d: Date) => format(d, 'yyyy-MM-dd')

// A shared empty array so no-event days get a stable prop reference (a fresh
// `[]` each render would defeat DayCell's memo).
const EMPTY: string[] = []

// ---- One day cell (memoized) --------------------------------
// The maps and callbacks it receives are stable while `events` is unchanged,
// so selecting a day only re-renders the two cells whose `selected` flips —
// not the whole grid.

interface DayCellProps {
  date: Date
  dayIso: string
  inMonth: boolean
  today: boolean
  /** Past days can't be reserved, so they're shown but inert. */
  past: boolean
  selected: boolean
  /** Distinct venue (course) ids on this day, in first-seen order. */
  venueIds: string[]
  colourByCourse: Map<string, number>
  nameByCourse: Map<string, string>
  onSelect: (iso: string) => void
}

const DayCell = memo(function DayCell({
  date, dayIso, inMonth, today, past, selected, venueIds, colourByCourse, nameByCourse, onSelect,
}: DayCellProps) {
  const has = venueIds.length > 0
  // Any upcoming day in view can be opened — landing on an empty one and being
  // told so beats a tap that does nothing.
  const selectable = inMonth && !past

  const label = `${format(date, 'EEEE, MMMM d')} — ${
    has ? `${venueIds.length} venue${venueIds.length === 1 ? '' : 's'} with a LinkUp` : 'no LinkUps'
  }`

  // The chip slot is two lines tall, so a third venue costs a name rather than
  // pushing the date off centre.
  const chips = venueIds.length > 2 ? venueIds.slice(0, 1) : venueIds
  const extra = venueIds.length - chips.length

  return (
    <button
      type="button"
      disabled={!selectable}
      aria-label={label}
      aria-pressed={selected}
      aria-current={today ? 'date' : undefined}
      onClick={() => onSelect(dayIso)}
      className={cn(
        'min-h-[3.25rem] sm:min-h-[4.75rem] rounded-lg p-1 sm:p-1.5 flex flex-col items-center transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-700 focus-visible:ring-offset-1',
        !inMonth && 'invisible',
        past && inMonth && 'opacity-40',
        // No resting cell background — the circle alone marks the selected day,
        // and the dots/chips already show which days have a LinkUp.
        selectable && 'hover:bg-green-50/70',
      )}
    >
      {/* The date number is centred in the space above the venue markers, in its
          own circle: filled for the selected day, outlined for today. */}
      <span className="flex-1 flex items-center justify-center">
        <span className={cn(
          'w-6 h-6 sm:w-7 sm:h-7 rounded-full flex items-center justify-center',
          'text-[11px] sm:text-sm leading-none tabular-nums',
          selected ? 'bg-green-900 text-white font-semibold'
            : today ? 'ring-1 ring-green-700/60 text-green-800 font-bold'
            : has ? 'text-green-950 font-medium'
            : 'text-green-900/45 font-medium',
        )}>
          {format(date, 'd')}
        </span>
      </span>

      {/* Venue markers sit in a fixed-height slot — reserved even on days with
          none — so every date in a row lines up at the same height. */}
      <span className="sm:hidden h-2.5 flex items-center justify-center gap-0.5">
        {venueIds.slice(0, 3).map(cid => (
          <span
            key={cid}
            className={cn('w-1.5 h-1.5 rounded-full', DOT[colourByCourse.get(cid) ?? 0])}
          />
        ))}
        {venueIds.length > 3 && (
          <span className="text-[9px] font-medium leading-none text-green-900/50">
            +{venueIds.length - 3}
          </span>
        )}
      </span>

      <span className="hidden sm:flex h-7 w-full flex-col justify-end gap-0.5 overflow-hidden text-left">
        {chips.map(cid => (
          <span
            key={cid}
            className={cn(
              'flex items-center gap-1 text-[10px] leading-tight',
              TEXT[colourByCourse.get(cid) ?? 0],
            )}
          >
            <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', DOT[colourByCourse.get(cid) ?? 0])} />
            <span className="truncate">{nameByCourse.get(cid) ?? 'Course'}</span>
          </span>
        ))}
        {extra > 0 && (
          <span className="text-[10px] leading-tight text-green-900/50">+{extra} more</span>
        )}
      </span>
    </button>
  )
})

// ---- Month calendar -----------------------------------------

interface EventCalendarProps {
  /** Any date within the visible month. */
  month: Date
  /** Events to plot — expected to cover (at least) the visible month. */
  events: HostedEvent[]
  selectedDate: string | null
  onSelectDate: (date: string) => void
  onMonthChange: (month: Date) => void
  /** When false, the "previous month" control is disabled (e.g. at today). */
  canGoPrev?: boolean
  /**
   * Course id to narrow the grid to. Every venue still appears in the legend —
   * with a dozen clubs in a month the cells truncate to "+N more", and picking
   * one is the only way to read the month at a glance.
   */
  venueFilter: string | null
  onVenueFilterChange: (courseId: string | null) => void
}

function EventCalendar({
  month, events, selectedDate, onSelectDate, onMonthChange, canGoPrev = true,
  venueFilter, onVenueFilterChange,
}: EventCalendarProps) {
  const todayIso = useMemo(() => iso(new Date()), [])

  // Assign each distinct venue a colour index (first-seen order — events arrive
  // sorted by date) and bucket events by day. Recomputed only when events change,
  // so the maps stay referentially stable across day selections.
  const { colourByCourse, nameByCourse, venues } = useMemo(() => {
    const colourByCourse = new Map<string, number>()
    const nameByCourse = new Map<string, string>()

    for (const e of events) {
      const cid = e.course?.id ?? 'unknown'
      if (!colourByCourse.has(cid)) {
        colourByCourse.set(cid, colourByCourse.size % VENUE_COLOUR_COUNT)
        nameByCourse.set(cid, e.course?.name ?? 'Course')
      }
    }

    const venues = Array.from(colourByCourse.entries())
      .map(([id, idx]) => ({ id, idx, name: nameByCourse.get(id) ?? 'Course' }))
      .sort((a, b) => a.name.localeCompare(b.name))

    return { colourByCourse, nameByCourse, venues }
  }, [events])

  // Kept separate from the colour assignment so filtering never re-colours a
  // venue (the legend must stay stable while the grid narrows).
  const venuesByDay = useMemo(() => {
    const byDay = new Map<string, string[]>()
    for (const e of events) {
      const cid = e.course?.id ?? 'unknown'
      if (venueFilter && cid !== venueFilter) continue
      const day = e.event_date.slice(0, 10)
      const list = byDay.get(day) ?? []
      if (!list.includes(cid)) list.push(cid)
      byDay.set(day, list)
    }
    return byDay
  }, [events, venueFilter])

  // A fixed 6-week grid keeps the calendar height stable across months.
  const days = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 0 })
    const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 0 })
    const out: Date[] = []
    for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) out.push(d)
    return out
  }, [month])

  const onCurrentMonth = isSameMonth(month, new Date())
  const filterable = venues.length > 1

  return (
    <div className="card card-pad">
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={() => onMonthChange(addMonths(month, -1))}
          disabled={!canGoPrev}
          aria-label="Previous month"
          className="w-9 h-9 rounded-full flex items-center justify-center text-green-900/60 hover:bg-green-50 disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <ChevronLeft className="w-5 h-5" strokeWidth={2} />
        </button>
        <div className="flex items-center gap-2 min-w-0">
          <p aria-live="polite" className="text-sm font-bold text-green-950 truncate">{format(month, 'MMMM yyyy')}</p>
          {!onCurrentMonth && (
            <button
              type="button"
              onClick={() => onMonthChange(startOfMonth(new Date()))}
              className="px-2 py-0.5 rounded-full text-[11px] font-semibold text-green-800 bg-green-900/[0.07] hover:bg-green-900/10 flex-shrink-0"
            >
              Today
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => onMonthChange(addMonths(month, 1))}
          aria-label="Next month"
          className="w-9 h-9 rounded-full flex items-center justify-center text-green-900/60 hover:bg-green-50"
        >
          <ChevronRight className="w-5 h-5" strokeWidth={2} />
        </button>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 mb-1">
        {WEEKDAYS.map(([full, initial]) => (
          <div key={full} className="text-center text-[10px] sm:text-xs font-medium text-green-900/40 py-1">
            <span className="sr-only">{full}</span>
            <span aria-hidden className="sm:hidden">{initial}</span>
            <span aria-hidden className="hidden sm:inline">{full}</span>
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-1">
        {days.map(d => {
          const dayIso = iso(d)
          const inMonth = isSameMonth(d, month)
          return (
            <DayCell
              key={dayIso}
              date={d}
              dayIso={dayIso}
              inMonth={inMonth}
              today={isToday(d)}
              past={dayIso < todayIso}
              selected={selectedDate === dayIso}
              venueIds={inMonth ? (venuesByDay.get(dayIso) ?? EMPTY) : EMPTY}
              colourByCourse={colourByCourse}
              nameByCourse={nameByCourse}
              onSelect={onSelectDate}
            />
          )
        })}
      </div>

      {/* Legend — doubles as a venue filter */}
      {venues.length > 0 && (
        <div className="mt-4 pt-3 border-t border-green-900/10">
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-[11px] font-medium text-green-900/50">
              {filterable ? 'Tap a venue to focus the month' : 'Venue this month'}
            </p>
            {venueFilter && (
              <button
                type="button"
                onClick={() => onVenueFilterChange(null)}
                className="text-[11px] font-semibold text-green-800 hover:underline flex-shrink-0"
              >
                Show all
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {venues.map(v => {
              const on = venueFilter === v.id
              const chip = cn(
                'flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-full border text-xs max-w-full',
                on ? 'bg-green-900 text-white border-green-900' : 'bg-white text-green-900/70 border-green-900/10',
              )
              const body = (
                <>
                  <span className={cn('w-2 h-2 rounded-full flex-shrink-0', on ? 'bg-white' : DOT[v.idx])} />
                  <span className="truncate">{v.name}</span>
                </>
              )
              // Filtering to the only venue in the month would change nothing.
              return filterable ? (
                <button
                  key={v.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onVenueFilterChange(on ? null : v.id)}
                  className={cn(chip, 'transition-colors', !on && 'hover:bg-green-50')}
                >
                  {body}
                </button>
              ) : (
                <span key={v.id} className={chip}>{body}</span>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export default memo(EventCalendar)
