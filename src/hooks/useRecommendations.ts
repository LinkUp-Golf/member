'use client'

// The playing partners admins have recommended to this member
// (GET /api/recommendations), shared by everything that shows them: the
// "Recommended for you" cards, the Suggested tag in the member list, and the
// Suggested tab when adding a player to a round. One request serves a page
// however many of those are on it, and Not now in one hides it in all.
//
// Kept per account: a different member signing in on the same tab never sees
// the previous member's list, even for the minute the cache would otherwise
// hold it.

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { useProfile } from '@/hooks/useProfile'
import type { IndustryCategory } from '@/types'

export interface Recommendation {
  id: string
  note: string | null
  sentAt: string
  member: {
    id: string
    name: string
    firstName: string
    lastName: string
    avatarUrl: string | null
    roleTitle: string | null
    businessName: string | null
    industry: IndustryCategory | null
  }
  shared: string[]
}

interface State {
  userId: string | null
  recommendations: Recommendation[]
  loaded: boolean
}

const FRESH_MS = 60_000
const EMPTY: State = { userId: null, recommendations: [], loaded: false }

let state: State = EMPTY
let fetchedAt = 0
let inflight: { userId: string; promise: Promise<void> } | null = null
const listeners = new Set<() => void>()

function set(next: State) {
  state = next
  listeners.forEach(l => l())
}

function load(userId: string, force = false): Promise<void> {
  if (inflight?.userId === userId) return inflight.promise
  if (!force && state.userId === userId && state.loaded && Date.now() - fetchedAt < FRESH_MS) return Promise.resolve()
  if (state.userId !== userId) set({ ...EMPTY, userId })

  const promise = fetch('/api/recommendations')
    .then(res => (res.ok ? res.json() : null))
    .then((json: unknown) => {
      if (state.userId !== userId) return
      fetchedAt = Date.now()
      set({ userId, recommendations: Array.isArray(json) ? (json as Recommendation[]) : state.recommendations, loaded: true })
    })
    .catch(() => {
      if (state.userId === userId) set({ ...state, loaded: true })
    })
    .finally(() => {
      if (inflight?.userId === userId) inflight = null
    })
  inflight = { userId, promise }
  return promise
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useRecommendations() {
  const { user } = useProfile()
  const userId = user?.id ?? null
  const snapshot = useSyncExternalStore(subscribe, () => state, () => EMPTY)

  useEffect(() => {
    if (userId) void load(userId)
  }, [userId])

  /** Drop one from every view, after Not now. */
  const remove = useCallback((id: string) => {
    set({ ...state, recommendations: state.recommendations.filter(r => r.id !== id) })
  }, [])

  const mine = snapshot.userId === userId
  return {
    recommendations: mine ? snapshot.recommendations : [],
    loaded: mine && snapshot.loaded,
    remove,
  }
}
