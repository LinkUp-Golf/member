'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Star } from 'lucide-react'
import { Spinner } from '@/components/ui/Loading'
import { cn, formatTeeTime } from '@/lib/utils'

// ============================================================
// The satisfaction survey form itself, as a bottom sheet.
//
// Shared by both ways in: BookingSurveyPrompt opens it automatically when a
// round finishes, and My Bookings opens it on demand for any past round — the
// route members use to rate rounds that predate the feature.
// ============================================================

/** The round being rated. `PendingSurvey` satisfies this shape. */
export interface SurveyTarget {
  booking_id: string
  booking_date: string
  tee_time: string
  course_name: string
}

const RATING_LABELS = ['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent'] as const

function StarRating({
  value,
  onChange,
  disabled,
}: {
  value: number
  onChange: (v: number) => void
  disabled?: boolean
}) {
  // Highlight follows the pointer before a choice is committed.
  const [hover, setHover] = useState(0)
  const shown = hover || value

  // Real radio inputs rather than buttons with role="radio": arrow-key
  // navigation and "3 of 5 selected" announcements come for free, and there's
  // no roving-tabindex to maintain.
  return (
    <fieldset className="border-0 p-0 m-0" onMouseLeave={() => setHover(0)}>
      <legend className="sr-only">Rating out of 5 stars</legend>
      <div className="flex items-center justify-center gap-1.5">
        {[1, 2, 3, 4, 5].map(n => (
          <label
            key={n}
            onMouseEnter={() => setHover(n)}
            className={cn('cursor-pointer', disabled && 'pointer-events-none')}
          >
            <input
              type="radio"
              name="booking-survey-rating"
              value={n}
              checked={value === n}
              disabled={disabled}
              onChange={() => onChange(n)}
              onFocus={() => setHover(n)}
              onBlur={() => setHover(0)}
              className="peer sr-only"
            />
            <span className="block p-1 rounded-lg transition-transform active:scale-90 peer-focus-visible:ring-2 peer-focus-visible:ring-green-700">
              <Star
                className={cn(
                  'w-9 h-9 transition-colors',
                  n <= shown ? 'text-gold fill-gold' : 'text-green-900/20',
                )}
                strokeWidth={1.5}
                aria-hidden
              />
            </span>
            <span className="sr-only">{`${n} star${n === 1 ? '' : 's'} — ${RATING_LABELS[n]}`}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

interface Props {
  /** The round to rate, or null when nothing is being asked. */
  target: SurveyTarget | null
  /** Closed without answering. */
  onDismiss: () => void
  /** A response was saved for this booking, at the given star rating. */
  onSubmitted: (bookingId: string, rating: number) => void
  /** "Not now" when the prompt appeared on its own; "Cancel" when opened by hand. */
  dismissLabel?: string
}

export default function BookingSurveySheet({
  target,
  onDismiss,
  onSubmitted,
  dismissLabel = 'Not now',
}: Props) {
  const [rating, setRating] = useState(0)
  const [attended, setAttended] = useState(true)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sheet = useRef<HTMLDivElement>(null)

  // Reset between rounds — a member with two unrated rounds answers each fresh.
  useEffect(() => {
    setRating(0)
    setAttended(true)
    setComment('')
    setError(null)
    // Move focus into the sheet, so a keyboard or screen-reader user lands on
    // the prompt rather than continuing to tab through the page behind it.
    if (target) sheet.current?.focus()
  }, [target?.booking_id, target])

  // Escape dismisses — a modal with no keyboard exit is a trap.
  useEffect(() => {
    if (!target) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onDismiss()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [target, submitting, onDismiss])

  const didNotAttend = !attended

  async function submit() {
    if (!target || rating === 0) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/surveys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          booking_id: target.booking_id,
          rating,
          attended,
          comment: comment.trim() || undefined,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? 'Could not save your response. Please try again.')
        return
      }
      onSubmitted(target.booking_id, rating)
    } catch {
      setError('Could not save your response. Check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // Kept inside AnimatePresence rather than short-circuiting above it, so the
  // sheet animates out when a response lands instead of vanishing.
  return (
    <AnimatePresence>
      {target && (
        <div
          className="fixed inset-0 z-[60] flex flex-col justify-end md:justify-center md:items-center md:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="survey-title"
        >
          <motion.div
            className="absolute inset-0"
            style={{ background: 'rgba(0,0,0,0.45)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          />
          <motion.div
            ref={sheet}
            tabIndex={-1}
            className="relative bg-white rounded-t-3xl md:rounded-3xl px-5 pt-6 pb-7 w-full md:max-w-md shadow-float focus:outline-none"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 38 }}
          >
            <p className="section-label">How was your round?</p>
            <h2 id="survey-title" className="text-lg font-bold text-green-950 mt-1">
              {target.course_name}
            </h2>
            <p className="text-xs text-green-900/50 mt-0.5">
              {new Date(`${target.booking_date}T00:00:00`).toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}
              {' · '}
              {formatTeeTime(target.tee_time)}
            </p>

            <div className="mt-6">
              <StarRating value={rating} onChange={setRating} disabled={submitting} />
              {/* Reserve the label's line so picking a rating doesn't shift the
                  buttons up under the member's finger mid-tap. */}
              <p className="h-5 mt-2 text-center text-sm font-medium text-green-800">
                {rating > 0 ? RATING_LABELS[rating] : ''}
              </p>
              <p className="text-center text-xs text-green-900/40">
                {didNotAttend
                  ? 'Rate your experience with the booking overall.'
                  : 'Tap a star to rate — required.'}
              </p>
            </div>

            <label className="mt-5 flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={didNotAttend}
                disabled={submitting}
                onChange={e => setAttended(!e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded accent-green-800 flex-shrink-0"
              />
              <span className="text-sm text-green-900/70 leading-snug">
                I didn&apos;t make it to this round
              </span>
            </label>

            {didNotAttend && (
              <div className="mt-3">
                <label htmlFor="survey-comment" className="text-xs text-green-900/50">
                  Anything you&apos;d like us to know? (optional)
                </label>
                <textarea
                  id="survey-comment"
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  disabled={submitting}
                  rows={3}
                  maxLength={1000}
                  placeholder="What got in the way?"
                  className="mt-1.5 w-full rounded-xl border border-green-900/15 px-3 py-2 text-sm text-green-950 placeholder:text-green-900/30 focus:outline-none focus:ring-2 focus:ring-green-700/40 resize-none"
                />
              </div>
            )}

            {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

            <div className="mt-5 flex items-center gap-3">
              <button
                type="button"
                onClick={onDismiss}
                disabled={submitting}
                className="btn btn-outline flex-shrink-0"
              >
                {dismissLabel}
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={rating === 0 || submitting}
                className="btn btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? <Spinner className="w-4 h-4" /> : 'Submit'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
