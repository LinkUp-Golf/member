'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// ============================================================
// Decides *when* to ask a member to rate a round.
//
// The prompt is driven by the booking's own schedule, not by navigation: the
// server hands back each pending survey's `due_at` (tee time + round length +
// grace period, in the course's timezone) and this hook arms a timer for the
// next one. A member sitting on the home screen at 4:40pm sees the prompt
// appear on its own, without touching the app.
//
// A round that finished while the app was closed is still asked about on the
// next open — otherwise only members who happen to be in-app at the exact
// minute would ever be surveyed, and most rounds would go unrated.
// ============================================================

export interface PendingSurvey {
  booking_id: string
  booking_date: string
  tee_time: string
  course_name: string
  course_city: string | null
  /** ISO instant this round became (or becomes) askable. */
  due_at: string
}

// setTimeout stores its delay in a signed 32-bit int; anything larger wraps
// around and fires immediately. Re-arm in chunks instead.
const MAX_TIMEOUT_MS = 2_147_483_647

// A refetch is only worth it if the tab has been away long enough for a new
// round to have finished or a booking to have changed.
const REFETCH_AFTER_MS = 10 * 60 * 1000

export function useBookingSurvey(enabled: boolean) {
  const [pending, setPending] = useState<PendingSurvey[]>([])
  // The one currently being asked. Held separately from `pending` so the modal
  // doesn't swap rounds underneath a member who is mid-answer.
  const [active, setActive] = useState<PendingSurvey | null>(null)

  // Dismissed for this session ("Not now"). The response is still outstanding
  // server-side, so it comes back on the next visit.
  const snoozed = useRef<Set<string>>(new Set())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastFetch = useRef(0)

  const load = useCallback(async () => {
    if (!enabled) return
    lastFetch.current = Date.now()
    try {
      const res = await fetch('/api/surveys/pending')
      if (!res.ok) return
      const json = await res.json()
      setPending(Array.isArray(json.surveys) ? json.surveys : [])
    } catch {
      // Offline or a transient failure — the next visit tries again. A survey
      // prompt is never worth surfacing an error over.
    }
  }, [enabled])

  useEffect(() => { load() }, [load])

  // Re-check after the tab has been in the background for a while: a round can
  // finish, or a booking can be cancelled, while the app sits open in a tab.
  useEffect(() => {
    if (!enabled) return
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastFetch.current < REFETCH_AFTER_MS) return
      load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [enabled, load])

  // Arm the trigger: show the earliest due survey now, or wait out the clock
  // for the earliest one still to come.
  useEffect(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    if (!enabled || active) return

    const candidates = pending
      .filter(s => !snoozed.current.has(s.booking_id))
      .sort((a, b) => a.due_at.localeCompare(b.due_at))
    if (candidates.length === 0) return

    const arm = () => {
      const now = Date.now()
      const next = candidates.find(s => new Date(s.due_at).getTime() <= now)
      if (next) { setActive(next); return }

      const soonest = candidates[0]
      if (!soonest) return
      const wait = new Date(soonest.due_at).getTime() - now
      // Chunk long waits so the delay never overflows setTimeout's 32-bit cap.
      timer.current = setTimeout(arm, Math.min(wait, MAX_TIMEOUT_MS))
    }

    arm()
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [pending, active, enabled])

  /** Answered — drop it locally so the same round is never asked twice. */
  const complete = useCallback((bookingId: string) => {
    setPending(prev => prev.filter(s => s.booking_id !== bookingId))
    setActive(null)
  }, [])

  /** "Not now" — hidden for this session, asked again next visit. */
  const snooze = useCallback((bookingId: string) => {
    snoozed.current.add(bookingId)
    setActive(null)
  }, [])

  return { active, complete, snooze }
}
