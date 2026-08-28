'use client'

// Pick the days a host wants to run, with no venue behind them.
//
// The sibling to VenueDateSelector, and deliberately not the same component.
// That one asks a club what it has open and offers only those days — the right
// answer at a venue already on LinkUp, and an impossible one at a club we
// haven't set up: there's no calendar to ask, so there are no open days to
// offer and no spot counts to show.
//
// So this offers every upcoming day and takes the host's word for it. What comes
// back is real dates, not a sentence, which is what lets the proposal become
// hosted_events rows attached to that host rather than a note for someone to
// read and retype.

import { useCallback, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  addDays, addMonths, endOfMonth, endOfWeek, format,
  isSameMonth, isToday, startOfMonth, startOfWeek,
} from 'date-fns'
import { cn } from '@/lib/utils'

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const

const iso = (d: Date) => format(d, 'yyyy-MM-dd')

// The year only earns its place once the date isn't in this one — a picker that
// can reach next spring shouldn't leave "Sat, Mar 7" ambiguous.
const fullDayLabel = (d: string) => {
  const date = new Date(`${d}T12:00:00`)
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return format(date, sameYear ? 'EEE, MMM d' : 'EEE, MMM d yyyy')
}

export default function DateMultiPicker({
  value,
  onChange,
  max,
  disabled = false,
}: {
  /** Selected dates, YYYY-MM-DD. */
  value: string[]
  onChange: (dates: string[]) => void
  /** Cap on how many days can be picked at once. */
  max?: number
  disabled?: boolean
}) {
  const [month, setMonth] = useState<Date>(() => startOfMonth(new Date()))
  const todayIso = useMemo(() => iso(new Date()), [])

  const gridDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(month), { weekStartsOn: 0 })
    const end = endOfWeek(endOfMonth(month), { weekStartsOn: 0 })
    const out: Date[] = []
    for (let d = start; d <= end; d = addDays(d, 1)) out.push(d)
    return out
  }, [month])

  const selected = useMemo(() => new Set(value), [value])
  const atMax = !!max && value.length >= max

  const toggle = useCallback(
    (date: string) => {
      if (selected.has(date)) {
        onChange(value.filter(d => d !== date))
        return
      }
      if (atMax) return
      onChange([...value, date].sort())
    },
    [selected, value, onChange, atMax],
  )

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

      <div className="px-2 py-2">
        <div className="grid grid-cols-7 mb-1">
          {WEEKDAYS.map((initial, i) => (
            <div key={i} className="text-center text-[10px] font-medium text-gray-400 py-1">
              {initial}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {gridDays.map(d => {
            const dayIso = iso(d)
            const inMonth = isSameMonth(d, month)
            const past = dayIso < todayIso
            const on = selected.has(dayIso)
            // A day past the cap stays visible but inert, so the limit shows
            // itself rather than a tap that silently does nothing.
            const blocked = disabled || past || (!on && atMax)

            return (
              <button
                key={dayIso}
                type="button"
                disabled={!inMonth || blocked}
                aria-pressed={on}
                aria-label={fullDayLabel(dayIso)}
                aria-current={isToday(d) ? 'date' : undefined}
                onClick={() => toggle(dayIso)}
                className={cn(
                  'h-9 rounded-lg text-xs tabular-nums transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-700 focus-visible:ring-offset-1',
                  !inMonth && 'invisible',
                  on
                    ? 'bg-green-900 text-white font-semibold'
                    : blocked
                      ? 'text-gray-300'
                      : isToday(d)
                        ? 'ring-1 ring-green-700/50 text-green-800 font-semibold hover:bg-green-50'
                        : 'text-gray-700 hover:bg-green-50',
                )}
              >
                {format(d, 'd')}
              </button>
            )
          })}
        </div>
      </div>

      {/* Every picked date, not only the ones this month can't show. A host
          listing a run of rounds is choosing across months, and the grid can
          only ever show them one month at a time — so what's actually been
          picked has to be readable in one place. */}
      {value.length > 0 && (
        <div className="px-3 py-2 border-t border-gray-100 space-y-1">
          <p className="text-[11px] text-gray-500">
            {value.length} date{value.length === 1 ? '' : 's'} picked
            {max ? ` · ${max} max` : ''}
          </p>
          <p className="text-[11px] text-gray-400 leading-relaxed">
            {value.map(fullDayLabel).join(' · ')}
          </p>
        </div>
      )}
    </div>
  )
}
