// ============================================================
// Client-side activity tracking.
//
// Never awaited and never surfaced: a dropped analytics event is
// not worth a spinner, a retry or an error toast in front of a
// member.
// ============================================================

import { apiClient } from '@/lib/api-client'
import { ACTIVITY_ACTIONS, type ActivityAction } from './areas'

/** Repeat visits to the same thing inside this window collapse into one row.
 *  Without it a member toggling between two tabs writes a row per toggle and
 *  the report measures restlessness rather than use. */
const DEDUPE_WINDOW_MS = 5 * 60 * 1000

const recentlySent = new Map<string, number>()

interface TrackOptions {
  targetId?: string | null
  targetLabel?: string | null
  path?: string | null
  /** Set false for repeatable actions — a second tap on an offer link is a
   *  second click, not a duplicate of the first. */
  dedupe?: boolean
}

export function trackActivity(action: ActivityAction, options: TrackOptions = {}): void {
  if (typeof window === 'undefined') return
  if (!ACTIVITY_ACTIONS[action]?.client) return

  const { targetId = null, targetLabel = null, dedupe = true } = options
  const path = options.path ?? window.location.pathname
  const now = Date.now()

  if (dedupe) {
    const key = `${action}:${targetId ?? ''}`
    const last = recentlySent.get(key)
    if (last !== undefined && now - last < DEDUPE_WINDOW_MS) return
    recentlySent.set(key, now)

    // The map only ever holds one entry per thing viewed this session, but
    // prune anyway so a long-lived tab doesn't accumulate stale keys.
    if (recentlySent.size > 100) {
      for (const [key, sentAt] of recentlySent) {
        if (now - sentAt >= DEDUPE_WINDOW_MS) recentlySent.delete(key)
      }
    }
  }

  void apiClient.post('/api/activity', { action, targetId, targetLabel, path })
}
