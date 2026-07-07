'use client'

import { useEffect, useState, useCallback, useId } from 'react'
import { useRouter } from 'next/navigation'
import { apiClient } from '@/lib/api-client'
import { createClient } from '@/lib/supabase'
import { useProfile } from '@/hooks/useProfile'
import { cn } from '@/lib/utils'
import IconBadge from '@/components/ui/IconBadge'
import { Bell } from 'lucide-react'

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
  }, [user, fetchUnread, instanceId])

  const iconColor = variant === 'light' ? 'text-white/70 hover:text-white' : 'text-green-900/60 hover:text-green-900'

  return (
    <button
      onClick={() => router.push('/more/notifications')}
      className={cn(
        'focus-ring relative flex items-center justify-center w-9 h-9 rounded-xl transition-all active:scale-90',
        variant === 'light' ? 'hover:bg-white/10' : 'hover:bg-green-900/06',
        iconColor,
        className
      )}
      aria-label={`Notifications${unreadCount > 0 ? ` — ${unreadCount} unread` : ''}`}
    >
      <Bell className="w-5 h-5" strokeWidth={1.75} />
      <IconBadge count={unreadCount} />
    </button>
  )
}
