'use client'

// Aggregated month view of tee-time availability across every bookable venue.
//
// Responsive strategy — the two breakpoints show the same month, not the same
// layout, because a Google-Calendar grid is only legible once cells are wide
// enough to hold a venue name:
//
//   md and up  — the real month grid. Tall cells, venue name chips inside each
//                day, "+N more" past what fits. Reading across a week is the
//                point, so the grid is the primary surface.
//   below md   — the grid shrinks to a dot map: one dot per venue open that
//                day, sized for a thumb, still showing the shape of the month
//                at a glance. The detail moves to the agenda beneath it, which
//                lists whole days as cards — no truncation, no pinching.
//
// The agenda is not a mobile-only fallback: it renders at every width as the
// day panel under the grid. Below md it simply carries the whole month when no
// day is selected, so a member always has something readable to scroll.

import { memo, useMemo } from 'react'
import { ChevronLeft, ChevronRight, CalendarDays, Clock, MapPin } from 'lucide-react'
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  addDays, addMonths, format, isSameMonth, isToday,
} from 'date-fns'
import { cn, formatTeeTime } from '@/lib/utils'
import { Spinner } from '@/components/ui/Loading'
import {
  VENUE_DOT as DOT,
  VENUE_TEXT as TEXT,
  VENUE_CHIP as CHIP,
  buildVenueColours,
} from '@/components/calendar/venue-colours'

// Mirrors CalendarVenue / CalendarOpening from @/lib/bookings/availability —
// declared here too so the component stays a pure presentational unit that a
// test or a story can feed by hand.
export interface CalendarVenue {
  id: string
  name: string
  city: string | null
  state: string | null
}

export interface CalendarOpening {
  courseId: string
  openSlots: number
  /** Earliest few tee times, wall-clock 'HH:mm:ss' at the venue. */
  tees: string[]
}

const WEEKDAYS = [
  ['Sunday', 'Sun', 'S'], ['Monday', 'Mon', 'M'], ['Tuesday', 'Tue', 'T'],
  ['Wednesday', 'Wed', 'W'], ['Thursday', 'Thu', 'T'], ['Friday', 'Fri', 'F'],
  ['Saturday', 'Sat', 'S'],
] as const

const iso = (d: Date) => format(d, 'yyyy-MM-dd')

// Stable empty array so days with nothing open keep a constant prop reference
// (a fresh `[]` per render would defeat DayCell's memo).
const EMPTY: CalendarOpening[] = []

const venueLocation = (v: CalendarVenue | undefined) =>
  [v?.city, v?.state].filter(Boolean).join(', ')

const teeCountLabel = (n: number) => `${n} tee time${n === 1 ? '' : 's'}`

// ---- One day cell (memoized) --------------------------------

interface DayCellProps {
  date: Date
  dayIso: string
  inMonth: boolean
  today: boolean
  past: boolean
  selected: boolean
  openings: CalendarOpening[]
  colourByVenue: Map<string, number>
  nameByVenue: Map<string, string>
  onSelect: (dayIso: string) => void
}

const DayCell = memo(function DayCell({
  date, dayIso, inMonth, today, past, selected, openings,
  colourByVenue, nameByVenue, onSelect,
}: DayCellProps) {
  const has = openings.length > 0
  // Any upcoming day in the month opens — landing on an empty one and being
  // told so beats a tap that does nothing.
  const selectable = inMonth && !past

  const label = `${format(date, 'EEEE, MMMM d')} — ${
    has ? `${openings.length} venue${openings.length === 1 ? '' : 's'} with tee times` : 'nothing open'
  }`

  // Three chips is what a cell holds at md without the row growing; the rest
  // roll up into a count that the agenda below spells out.
  const shown = openings.length > 3 ? openings.slice(0, 2) : openings
  const extra = openings.length - shown.length

  return (
    <button
      type="button"
      disabled={!selectable}
      aria-label={label}
      aria-pressed={selected}
      aria-current={today ? 'date' : undefined}
      onClick={() => onSelect(dayIso)}
      className={cn(
        'flex flex-col rounded-lg transition-colors text-left',
        'min-h-[3rem] p-1 items-center',
        'md:min-h-[6.5rem] md:p-1.5 md:items-stretch md:border md:border-green-900/[0.07]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-700 focus-visible:ring-offset-1',
        !inMonth && 'invisible',
        past && inMonth && 'opacity-40',
        selected && 'md:border-green-900 md:bg-green-50/40',
        selectable && !selected && 'hover:bg-green-50/70',
      )}
    >
      {/* Date number — centred over the dots on mobile, top-left of the cell at
          md where the chips need the width. */}
      <span className="flex-1 flex items-center justify-center md:flex-none md:justify-start md:mb-1">
        <span className={cn(
          'w-6 h-6 md:w-6 md:h-6 rounded-full flex items-center justify-center',
          'text-[11px] md:text-xs leading-none tabular-nums',
          selected ? 'bg-green-900 text-white font-semibold'
            : today ? 'ring-1 ring-green-700/60 text-green-800 font-bold'
            : has ? 'text-green-950 font-semibold'
            : 'text-green-900/40 font-medium',
        )}>
          {format(date, 'd')}
        </span>
      </span>

      {/* Below md — a dot per venue. The slot is reserved even on empty days so
          every date in a row sits at the same height. */}
      <span className="md:hidden h-2.5 flex items-center justify-center gap-0.5">
        {openings.slice(0, 3).map(o => (
          <span
            key={o.courseId}
            className={cn('w-1.5 h-1.5 rounded-full', DOT[colourByVenue.get(o.courseId) ?? 0])}
          />
        ))}
        {openings.length > 3 && (
          <span className="text-[9px] font-medium leading-none text-green-900/50">
            +{openings.length - 3}
          </span>
        )}
      </span>

      {/* md and up — the venue names themselves, which is what makes the grid
          worth showing at this width. */}
      <span className="hidden md:flex flex-col gap-0.5 overflow-hidden">
        {shown.map(o => {
          const idx = colourByVenue.get(o.courseId) ?? 0
          return (
            <span
              key={o.courseId}
              className={cn(
                'flex items-center gap-1 rounded px-1 py-0.5 border text-[10px] leading-tight',
                CHIP[idx],
              )}
            >
              <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', DOT[idx])} />
              <span className={cn('truncate font-medium', TEXT[idx])}>
                {nameByVenue.get(o.courseId) ?? 'Venue'}
              </span>
            </span>
          )
        })}
        {extra > 0 && (
          <span className="text-[10px] leading-tight text-green-900/50 px-1">+{extra} more</span>
        )}
      </span>
    </button>
  )
})

// ---- Agenda row ---------------------------------------------

function AgendaDay({
  dayIso, openings, venuesById, colourByVenue, onPickOpening, showDate,
}: {
  dayIso: string
  openings: CalendarOpening[]
  venuesById: Map<string, CalendarVenue>
  colourByVenue: Map<string, number>
  onPickOpening: (courseId: string, date: string) => void
  showDate: boolean
}) {
  const date = new Date(`${dayIso}T12:00:00`)

  return (
    <div className="flex gap-3">
      {showDate && (
        <div className="flex-shrink-0 w-11 pt-1 text-center">
          <p className="text-[10px] uppercase tracking-wider font-medium text-green-900/40">
            {format(date, 'EEE')}
          </p>
          <p className={cn(
            'font-sans font-black text-xl leading-tight',
            isToday(date) ? 'text-green-700' : 'text-green-950',
          )}>
            {format(date, 'd')}
          </p>
        </div>
      )}

      <div className="flex-1 min-w-0 space-y-2">
        {openings.map(o => {
          const venue = venuesById.get(o.courseId)
          const idx = colourByVenue.get(o.courseId) ?? 0
          const location = venueLocation(venue)

          return (
            <button
              key={o.courseId}
              type="button"
              onClick={() => onPickOpening(o.courseId, dayIso)}
              className="w-full text-left flex items-center gap-3 rounded-xl border border-green-900/10 bg-white px-3 py-2.5 transition-colors hover:bg-green-50/50 active:opacity-70"
            >
              <span className={cn('w-1 self-stretch rounded-full flex-shrink-0', DOT[idx])} />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-green-950 truncate">
                  {venue?.name ?? 'Venue'}
                </span>
                <span className="mt-0.5 flex items-center gap-2.5 text-[11px] text-green-900/45">
                  {o.tees[0] && (
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3 flex-shrink-0" strokeWidth={2} />
                      from {formatTeeTime(o.tees[0])}
                    </span>
                  )}
                  <span className={cn('font-medium', TEXT[idx])}>{teeCountLabel(o.openSlots)}</span>
                </span>
                {location && (
                  <span className="mt-0.5 flex items-center gap-1 text-[11px] text-green-900/40">
                    <MapPin className="w-3 h-3 flex-shrink-0" strokeWidth={2} />
                    <span className="truncate">{location}</span>
                  </span>
                )}
              </span>
              <ChevronRight className="w-4 h-4 flex-shrink-0 text-green-900/25" strokeWidth={2} />
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ---- Month calendar -----------------------------------------

interface VenueAvailabilityCalendarProps {
  /** Any date within the visible month. */
  month: Date
  venues: CalendarVenue[]
  /** 'YYYY-MM-DD' → the venues with tee times open that day. */
  days: Record<string, CalendarOpening[]>
  loading: boolean
  /** null = no day picked; below md the agenda then carries the whole month. */
  selectedDate: string | null
  onSelectDate: (date: string | null) => void
  onMonthChange: (month: Date) => void
  canGoPrev?: boolean
  venueFilter: string | null
  onVenueFilterChange: (courseId: string | null) => void
  /** Booking a specific venue on a specific day. */
  onPickOpening: (courseId: string, date: string) => void
}

function VenueAvailabilityCalendar({
  month, venues, days, loading, selectedDate, onSelectDate, onMonthChange,
  canGoPrev = true, venueFilter, onVenueFilterChange, onPickOpening,
}: VenueAvailabilityCalendarProps) {
  const todayIso = useMemo(() => iso(new Date()), [])

  const { colourByVenue, nameByVenue, venuesById } = useMemo(() => {
    // Colours follow the venue list — sorted by name server-side — so a venue
    // keeps its colour no matter which days it happens to be open.
    const colourByVenue = buildVenueColours(venues.map(v => v.id))
    const nameByVenue = new Map(venues.map(v => [v.id, v.name]))
    const venuesById = new Map(venues.map(v => [v.id, v]))
    return { colourByVenue, nameByVenue, venuesById }
  }, [venues])

  // Kept separate from the colour assignment so filtering never re-colours a
  // venue — the legend has to stay stable while the grid narrows.
  const visibleDays = useMemo(() => {
    if (!venueFilter) return days
    const out: Record<string, CalendarOpening[]> = {}
    for (const [day, list] of Object.entries(days)) {
      const kept = list.filter(o => o.courseId === venueFilter)
      if (kept.length) out[day] = kept
    }
    return out
  }, [days, venueFilter])

  // A fixed 6-week grid would keep the height stable, but an agenda sits right
  // below it — trailing blank weeks would just push it down, so the grid ends
  // with the month.
  const gridDays = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 0 })
    const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 0 })
    const out: Date[] = []
    for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) out.push(d)
    return out
  }, [month])

  // Every day in the month that has something open, ascending — what the agenda
  // walks when no single day is selected.
  const agendaDays = useMemo(
    () => Object.keys(visibleDays).filter(d => isSameMonth(new Date(`${d}T12:00:00`), month)).sort(),
    [visibleDays, month],
  )

  const monthOpeningCount = useMemo(
    () => agendaDays.reduce((n, d) => n + (visibleDays[d]?.length ?? 0), 0),
    [agendaDays, visibleDays],
  )

  const onCurrentMonth = isSameMonth(month, new Date())
  const filterable = venues.length > 1
  const selectedOpenings = selectedDate ? (visibleDays[selectedDate] ?? []) : []
  const filteredVenueName = venueFilter ? nameByVenue.get(venueFilter) : null

  return (
    <div className="space-y-4">
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
            <p aria-live="polite" className="text-sm font-bold text-green-950 truncate">
              {format(month, 'MMMM yyyy')}
            </p>
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

        {/* Weekday header — initials on the dot map, short names once the cells
            are wide enough to carry them. */}
        <div className="grid grid-cols-7 mb-1">
          {WEEKDAYS.map(([full, short, initial]) => (
            <div key={full} className="text-center md:text-left md:px-1.5 text-[10px] md:text-xs font-medium text-green-900/40 py-1">
              <span className="sr-only">{full}</span>
              <span aria-hidden className="md:hidden">{initial}</span>
              <span aria-hidden className="hidden md:inline">{short}</span>
            </div>
          ))}
        </div>

        <div className="relative">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/70">
              <Spinner className="w-5 h-5 text-green-900" />
            </div>
          )}
          <div className="grid grid-cols-7 gap-1">
            {gridDays.map(d => {
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
                  openings={inMonth ? (visibleDays[dayIso] ?? EMPTY) : EMPTY}
                  colourByVenue={colourByVenue}
                  nameByVenue={nameByVenue}
                  onSelect={dayIso === selectedDate ? () => onSelectDate(null) : onSelectDate}
                />
              )
            })}
          </div>
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
                const idx = colourByVenue.get(v.id) ?? 0
                const chip = cn(
                  'flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-full border text-xs max-w-full',
                  on ? 'bg-green-900 text-white border-green-900' : 'bg-white text-green-900/70 border-green-900/10',
                )
                const body = (
                  <>
                    <span className={cn('w-2 h-2 rounded-full flex-shrink-0', on ? 'bg-white' : DOT[idx])} />
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

      {/* Agenda — the selected day, or the whole month when none is picked. */}
      {!loading && (
        selectedDate ? (
          <div>
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <h3 className="text-sm font-bold text-green-950">
                {format(new Date(`${selectedDate}T12:00:00`), 'EEEE, MMMM d')}
              </h3>
              <button
                type="button"
                onClick={() => onSelectDate(null)}
                className="text-[11px] font-semibold text-green-800 hover:underline flex-shrink-0"
              >
                Whole month
              </button>
            </div>
            {selectedOpenings.length > 0 ? (
              <AgendaDay
                dayIso={selectedDate}
                openings={selectedOpenings}
                venuesById={venuesById}
                colourByVenue={colourByVenue}
                onPickOpening={onPickOpening}
                showDate={false}
              />
            ) : (
              <div className="card card-pad text-center py-8">
                <p className="text-sm text-green-900/60">
                  {filteredVenueName
                    ? `No tee times at ${filteredVenueName} on this day.`
                    : 'No tee times open on this day.'}
                </p>
                <p className="text-xs text-green-900/40 mt-1">
                  {monthOpeningCount > 0 ? 'Pick a highlighted day above.' : 'Try another month.'}
                </p>
              </div>
            )}
          </div>
        ) : agendaDays.length > 0 ? (
          <div>
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <h3 className="text-sm font-bold text-green-950">
                Everything in {format(month, 'MMMM')}
              </h3>
              <span className="text-[11px] text-green-900/45 flex-shrink-0">
                {agendaDays.length} day{agendaDays.length === 1 ? '' : 's'} open
              </span>
            </div>
            <div className="space-y-3">
              {agendaDays.map(d => (
                <AgendaDay
                  key={d}
                  dayIso={d}
                  openings={visibleDays[d] ?? EMPTY}
                  venuesById={venuesById}
                  colourByVenue={colourByVenue}
                  onPickOpening={onPickOpening}
                  showDate
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="card card-pad text-center py-10">
            <CalendarDays className="w-8 h-8 mx-auto text-green-900/30" strokeWidth={1.5} />
            <p className="text-sm text-green-900/60 mt-3">
              {filteredVenueName
                ? `No tee times at ${filteredVenueName} in ${format(month, 'MMMM')}.`
                : `No tee times open in ${format(month, 'MMMM')}.`}
            </p>
            <button
              onClick={() => onMonthChange(addMonths(month, 1))}
              className="btn btn-outline btn-sm mt-4 mx-auto"
            >
              {format(addMonths(month, 1), 'MMMM')}
              <ChevronRight className="w-3.5 h-3.5" strokeWidth={2} />
            </button>
          </div>
        )
      )}
    </div>
  )
}

export default memo(VenueAvailabilityCalendar)
