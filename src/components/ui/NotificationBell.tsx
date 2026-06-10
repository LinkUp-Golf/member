'use client'

import { useEffect, useState, useCallback, useId } from 'react'
import { useRouter } from 'next/navigation'
import { apiClient } from '@/lib/api-client'
import { createClient } from '@/lib/supabase'
import { useProfile } from '@/hooks/useProfile'
import { cn } from '@/lib/utils'

interface Props {
  className?: string
  /** Light variant (white icon) for use on dark backgrounds like top-bar / sidebar */
  variant?: 'light' | 'dark'
}

export default function NotificationBell({ className, variant = 'light' }: Props) {
  const [unreadCount, setUnreadCount] = useState(0)
  const router = useRouter()
  const { user } = useProfile()
  const instanceId = useId().replace(/:/g, '')

  const fetchUnread = useCallback(async () => {
    const res = await apiClient.get<{ unread_count: number }>(
      '/api/notifications?count_only=true'
    )
    setUnreadCount(res.data?.unread_count ?? 0)
  }, [])

  useEffect(() => {
    if (!user) return
    fetchUnread()

    const supabase = createClient()
    const channel = supabase
      .channel(`notification_bell_${instanceId}`)
      .on(
        'postgres_changes',
        {
          event:  'INSERT',
          schema: 'public',
          table:  'notification_log',
          filter: `member_id=eq.${user.id}`,
        },
        () => setUnreadCount(prev => prev + 1)
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [user, fetchUnread])

  const iconColor = variant === 'light' ? 'text-white/70 hover:text-white' : 'text-green-900/60 hover:text-green-900'

  return (
    <button
      onClick={() => router.push('/more/notifications')}
      className={cn(
        'relative flex items-center justify-center w-9 h-9 rounded-xl transition-colors',
        variant === 'light' ? 'hover:bg-white/10' : 'hover:bg-green-900/06',
        iconColor,
        className
      )}
      aria-label={`Notifications${unreadCount > 0 ? ` — ${unreadCount} unread` : ''}`}
    >
      <BellIcon className="w-5 h-5" />
      {unreadCount > 0 && (
        <span
          className="absolute top-0.5 right-0.5 min-w-[16px] h-4 flex items-center justify-center px-1 rounded-full text-[9px] font-bold leading-none text-white"
          style={{ background: '#e53935' }}
        >
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  )
}

function BellIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  )
}
