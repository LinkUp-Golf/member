'use client'

// The dates a host picked, one row each, with that date's tee time.
//
// Sits under either date picker (VenueDateSelector on Current LinkUps,
// DateMultiPicker on New LinkUp). Each date becomes its own hosted event, and
// two days at the same club rarely tee off at the same time, so the tee time
// is asked per date rather than once for the whole set.
//
// It's also the one place every picked date is listed, whichever month it's
// in — the pickers only ever show a month at a time.

import { X } from 'lucide-react'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import { TEE_TIME_REQUIRED } from '@/lib/hosts/tee-time'

const dateLabel = (iso: string) => format(new Date(`${iso}T12:00:00`), 'MMM d, yyyy')

export default function DateTeeTimeList({
  dates,
  teeTimes,
  onTeeTimeChange,
  onRemove,
  invalidDates = [],
  max,
  tone = 'neutral',
  idPrefix = 'tee-time',
}: {
  /** Picked dates, YYYY-MM-DD. */
  dates: string[]
  /** date → "HH:MM"; absent or '' means not set yet, which won't submit. */
  teeTimes: Record<string, string>
  onTeeTimeChange: (date: string, value: string) => void
  /** Omit to hide the remove buttons (editing a single event). */
  onRemove?: (date: string) => void
  /**
   * Dates whose tee time is missing, once the form has been told to say so.
   * Passing them marks those rows and prints the reason — kept here so all
   * three forms that ask for tee times word it the same way.
   */
  invalidDates?: string[]
  /** Cap on dates, to say so once it's reached. */
  max?: number
  /** 'member' matches the member app's navy-on-cream forms. */
  tone?: 'neutral' | 'member'
  idPrefix?: string
}) {
  if (dates.length === 0) return null
  const sorted = [...dates].sort()
  const invalid = new Set(invalidDates)

  return (
    <div className="mt-2 space-y-1.5">
      {sorted.map(date => {
        const id = `${idPrefix}-${date}`
        return (
          <div key={date} className="flex items-center gap-2">
            <label
              htmlFor={id}
              className={cn(
                'w-24 flex-shrink-0 text-xs font-medium tabular-nums',
                tone === 'member' ? 'text-green-900/80' : 'text-gray-700',
              )}
            >
              {dateLabel(date)}
            </label>
            <input
              id={id}
              type="time"
              required
              className={cn(
                'input text-sm flex-1 min-w-0',
                invalid.has(date) && 'border-red-400 focus:border-red-400',
              )}
              aria-label={`Tee time, ${dateLabel(date)}`}
              aria-invalid={invalid.has(date) || undefined}
              value={teeTimes[date] ?? ''}
              onChange={e => onTeeTimeChange(date, e.target.value)}
            />
            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(date)}
                aria-label={`Remove ${dateLabel(date)}`}
                className={cn(
                  'flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center',
                  'text-gray-400 hover:text-red-600 hover:bg-red-50',
                )}
              >
                <X className="w-3.5 h-3.5" strokeWidth={2.2} />
              </button>
            )}
          </div>
        )
      })}

      {invalid.size > 0 && <p className="text-xs text-red-500">{TEE_TIME_REQUIRED}</p>}

      {max && dates.length >= max && (
        <p className="text-[11px] text-amber-600">
          That&apos;s the most dates you can list at once ({max}).
        </p>
      )}
    </div>
  )
}
