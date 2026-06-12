'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useProfile } from '@/hooks/useProfile'
import { apiClient } from '@/lib/api-client'
import { formatRelativeTime } from '@/lib/utils'
import AppShell from '@/components/layout/AppShell'
import { CardSkeleton } from '@/components/ui/Loading'
import type { NotificationLog, NotificationType } from '@/types'

const TYPE_ICONS: Record<NotificationType, string> = {
  new_member:      '👋',
  booking:         '⛳',
  visiting_member: '✈️',
  message:         '💬',
  focus_linkup:    '🎯',
  play_suggestion: '🏌️',
  guest_access:    '🔑',
  referral:        '🤝',
  test:            '🔔',
  general:         '📣',
}

const TYPE_LABELS: Record<NotificationType, string> = {
  new_member:      'New member',
  booking:         'Tee time',
  visiting_member: 'Visiting member',
  message:         'Message',
  focus_linkup:    'Focus LinkUp',
  play_suggestion: 'Play suggestion',
  guest_access:    'Guest access',
  referral:        'Referral',
  test:            'Test',
  general:         'Notification',
}

interface NotifResponse {
  notifications: NotificationLog[]
  hasMore: boolean
  nextCursor: string | null
  unread_count: number
}

function groupByDate(items: NotificationLog[]): { label: string; items: NotificationLog[] }[] {
  const now   = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86_400_000)
  const weekAgo   = new Date(today.getTime() - 7 * 86_400_000)

  const groups = new Map<string, NotificationLog[]>()

  for (const n of items) {
    const d = new Date(n.created_at)
    let label: string
    if (d >= today)          label = 'Today'
    else if (d >= yesterday) label = 'Yesterday'
    else if (d >= weekAgo)   label = 'This week'
    else                     label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

    const existing = groups.get(label)
    if (existing) existing.push(n)
    else groups.set(label, [n])
  }

  return Array.from(groups.entries()).map(([label, groupItems]) => ({ label, items: groupItems }))
}

export default function NotificationsPage() {
  const { user } = useProfile()
  const [notifications, setNotifications]   = useState<NotificationLog[]>([])
  const [hasMore, setHasMore]               = useState(false)
  const [nextCursor, setNextCursor]         = useState<string | null>(null)
  const [loading, setLoading]               = useState(true)
  const [loadingMore, setLoadingMore]       = useState(false)
  const [markingRead, setMarkingRead]       = useState(false)
  const [unreadCount, setUnreadCount]       = useState(0)

  const load = useCallback(async (cursor?: string | null) => {
    const url = cursor
      ? `/api/notifications?before=${encodeURIComponent(cursor)}`
      : '/api/notifications'
    const res = await apiClient.get<NotifResponse>(url)
    return res.data
  }, [])

  useEffect(() => {
    if (!user) return
    load().then(data => {
      if (!data) return
      setNotifications(data.notifications)
      setHasMore(data.hasMore)
      setNextCursor(data.nextCursor)
      setUnreadCount(data.unread_count)
      setLoading(false)
    })
  }, [user, load])

  async function loadMore() {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    const data = await load(nextCursor)
    if (data) {
      setNotifications(prev => [...prev, ...data.notifications])
      setHasMore(data.hasMore)
      setNextCursor(data.nextCursor)
    }
    setLoadingMore(false)
  }

  async function markAllRead() {
    if (unreadCount === 0 || markingRead) return
    setMarkingRead(true)
    await apiClient.patch('/api/notifications/read-all', {})
    setNotifications(prev =>
      prev.map(n => n.read_at ? n : { ...n, read_at: new Date().toISOString() })
    )
    setUnreadCount(0)
    setMarkingRead(false)
  }

  const groups = groupByDate(notifications)

  return (
    <AppShell
      header={
        <div className="top-bar flex items-center justify-between">
          <div>
            <div className="font-sans font-black text-2xl" style={{ color: 'var(--color-gold)' }}>
              Notifications
            </div>
            {unreadCount > 0 && (
              <div className="logo-subtitle">{unreadCount} unread</div>
            )}
          </div>
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              disabled={markingRead}
              className="text-xs font-medium transition-colors"
              style={{ color: 'var(--color-gold)' }}
            >
              {markingRead ? 'Marking…' : 'Mark all read'}
            </button>
          )}
        </div>
      }
    >
      <div className="pt-4 pb-8">
        {loading ? (
          <div className="px-5 space-y-3">
            {[1, 2, 3, 4, 5].map(i => <CardSkeleton key={i} lines={2} />)}
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center text-center px-8 py-16">
            <div
              className="w-20 h-20 rounded-3xl flex items-center justify-center text-4xl mb-5"
              style={{ background: 'rgba(0,38,105,0.06)', border: '1.5px solid rgba(0,38,105,0.08)' }}
            >
              🔔
            </div>
            <p className="font-sans font-black text-xl text-green-900 mb-2">No notifications yet</p>
            <p className="text-sm text-green-900/45 leading-relaxed max-w-xs">
              You&apos;ll see messages, bookings, member activity, and community updates here as they arrive.
            </p>
          </div>
        ) : (
          <div className="px-5 space-y-5">
            {groups.map(group => (
              <div key={group.label}>
                <p className="section-label mb-2">{group.label}</p>
                <div className="card">
                  {group.items.map((n, i) => (
                    <NotifItem
                      key={n.id}
                      notif={n}
                      isLast={i === group.items.length - 1}
                      onRead={() => setUnreadCount(prev => Math.max(0, prev - 1))}
                    />
                  ))}
                </div>
              </div>
            ))}

            {hasMore && (
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="w-full py-3 text-sm text-green-900/40 hover:text-green-900/60 transition-colors"
              >
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            )}
          </div>
        )}
      </div>
    </AppShell>
  )
}

function NotifItem({
  notif,
  isLast,
  onRead,
}: {
  notif: NotificationLog
  isLast: boolean
  onRead: () => void
}) {
  const router = useRouter()
  const isUnread = !notif.read_at
  const type = notif.type as NotificationType

  async function handleClick() {
    if (isUnread) {
      // Optimistically update UI before the network call
      onRead()
      apiClient.patch(`/api/notifications/${notif.id}`, {}).catch(() => {})
    }
    if (notif.url) {
      router.push(notif.url)
    }
  }

  return (
    <button
      onClick={handleClick}
      className="w-full flex items-start gap-3 px-4 py-4 text-left transition-colors hover:bg-green-50/60 active:bg-green-50"
      style={{
        borderBottom: isLast ? 'none' : '0.5px solid rgba(0,38,105,0.06)',
        background: isUnread ? 'rgba(133,187,101,0.05)' : undefined,
      }}
    >
      {/* Type icon */}
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0 mt-0.5"
        style={{ background: 'rgba(0,38,105,0.05)' }}
      >
        {TYPE_ICONS[type] ?? '📣'}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="text-[10px] uppercase tracking-wider" style={{ color: 'rgba(0,38,105,0.35)' }}>
            {TYPE_LABELS[type] ?? 'Notification'}
          </span>
          <span className="text-[10px]" style={{ color: 'rgba(0,38,105,0.2)' }}>·</span>
          <span className="text-[10px]" style={{ color: 'rgba(0,38,105,0.35)' }}>
            {formatRelativeTime(notif.created_at)}
          </span>
        </div>
        <p className="text-sm font-semibold leading-snug" style={{ color: 'var(--color-green-900)' }}>
          {notif.title}
        </p>
        <p className="text-xs mt-0.5 leading-relaxed line-clamp-2" style={{ color: 'rgba(0,38,105,0.5)' }}>
          {notif.body}
        </p>
      </div>

      {/* Right side: unread dot or chevron */}
      <div className="flex-shrink-0 flex flex-col items-center justify-start mt-1.5 gap-1.5">
        {isUnread && (
          <div className="w-2 h-2 rounded-full" style={{ background: '#85bb65' }} />
        )}
        {notif.url && (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"
            strokeWidth={2} style={{ color: 'rgba(0,38,105,0.2)' }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        )}
      </div>
    </button>
  )
}
