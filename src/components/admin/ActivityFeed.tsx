'use client'

// ============================================================
// The raw activity trail behind the usage report — one row per
// visit or action. Used twice: as the site-wide feed on the
// analytics page, and inside the per-member panel.
// ============================================================

import { useState, useEffect, useCallback } from 'react'
import { Badge } from '@/components/admin/AdminUI'
import { ContentLoader } from '@/components/ui/Loading'
import { formatRelativeTime } from '@/lib/utils'
import { format } from 'date-fns'

export interface ActivityEvent {
  id: string
  memberId: string
  memberName: string
  memberEmail: string | null
  area: string
  areaLabel: string
  action: string
  actionLabel: string
  kind: 'view' | 'action'
  targetId: string | null
  targetLabel: string | null
  path: string | null
  createdAt: string
}

export default function ActivityFeed({
  query,
  showMember = true,
  emptyLabel = 'No activity recorded in this window.',
  pageSize = 50,
}: {
  /** Query string for /api/admin/analytics/events, without the leading `?`. */
  query: string
  showMember?: boolean
  emptyLabel?: string
  pageSize?: number
}) {
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchPage = useCallback(
    async (before: string | null) => {
      const params = new URLSearchParams(query)
      params.set('limit', String(pageSize))
      if (before) params.set('before', before)

      const res = await fetch(`/api/admin/analytics/events?${params.toString()}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Could not load activity.')
      return json as { events: ActivityEvent[]; nextCursor: string | null }
    },
    [query, pageSize]
  )

  // Reset on every filter change — appending a first page onto the previous
  // filter's results would show a feed that matches neither.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchPage(null)
      .then(page => {
        if (cancelled) return
        setEvents(page.events)
        setCursor(page.nextCursor)
        setError(null)
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [fetchPage])

  async function loadMore() {
    if (!cursor || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await fetchPage(cursor)
      setEvents(current => [...current, ...page.events])
      setCursor(page.nextCursor)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load more activity.')
    }
    setLoadingMore(false)
  }

  if (loading) return <ContentLoader />

  if (error) {
    return <p className="text-sm text-red-500 py-6 text-center">{error}</p>
  }

  if (!events.length) {
    return <p className="text-sm text-gray-400 italic py-8 text-center">{emptyLabel}</p>
  }

  return (
    <div>
      <ul className="divide-y divide-gray-50">
        {events.map(event => (
          <li key={event.id} className="py-3 flex items-start gap-3">
            <span
              className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                event.kind === 'action' ? 'bg-green-700' : 'bg-gray-300'
              }`}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-gray-700">
                {showMember && <span className="font-medium text-gray-900">{event.memberName}</span>}
                {showMember && ' — '}
                {event.actionLabel}
                {event.targetLabel && (
                  <span className="text-gray-500"> · {event.targetLabel}</span>
                )}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                <span className="uppercase tracking-wider">{event.areaLabel}</span>
                {' · '}
                <time dateTime={event.createdAt} title={format(new Date(event.createdAt), 'PPpp')}>
                  {formatRelativeTime(event.createdAt)}
                </time>
              </p>
            </div>
            <Badge label={event.kind === 'action' ? 'Action' : 'Visit'} colour={event.kind === 'action' ? 'green' : 'gray'} />
          </li>
        ))}
      </ul>

      {cursor && (
        <div className="pt-3 text-center">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="text-xs font-medium text-green-800 hover:text-green-900 disabled:opacity-50"
          >
            {loadingMore ? 'Loading…' : 'Load older activity'}
          </button>
        </div>
      )}
    </div>
  )
}
