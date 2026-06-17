'use client'

import { useEffect, useState, useCallback, useId } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import { apiClient } from '@/lib/api-client'
import { useProfile } from '@/hooks/useProfile'
import Icon from '@/components/ui/Icon'
import { cn } from '@/lib/utils'

interface Props {
  className?: string
  variant?: 'light' | 'dark'
}

export default function MessagesIcon({ className, variant = 'light' }: Props) {
  const [count, setCount] = useState(0)
  const { user } = useProfile()
  const instanceId = useId().replace(/:/g, '')

  const fetchCounts = useCallback(async () => {
    const res = await apiClient.get<{ unread_messages: number; pending_invitations: number }>(
      '/api/conversations?counts_only=true'
    )
    if (res.data) {
      setCount(res.data.unread_messages + res.data.pending_invitations)
    }
  }, [])

  useEffect(() => {
    if (!user) return
    fetchCounts()

    const supabase = createClient()
    const channel = supabase
      .channel(`messages_icon_${instanceId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => fetchCounts())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_participants', filter: `member_id=eq.${user.id}` }, () => fetchCounts())
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [user, fetchCounts, instanceId])

  const iconColor = variant === 'light'
    ? 'text-white/70 hover:text-white'
    : 'text-green-900/60 hover:text-green-900'

  return (
    <Link
      href="/messages"
      className={cn(
        'relative flex items-center justify-center w-9 h-9 rounded-xl transition-colors',
        variant === 'light' ? 'hover:bg-white/10' : 'hover:bg-green-900/06',
        iconColor,
        className
      )}
      aria-label={`Messages${count > 0 ? ` — ${count} unread` : ''}`}
    >
      <Icon name="messages" className="w-5 h-5" />
      {count > 0 && (
        <span
          className="absolute top-0.5 right-0.5 min-w-[16px] h-4 flex items-center justify-center px-1 rounded-full text-[9px] font-bold leading-none text-white"
          style={{ background: '#e53935' }}
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  )
}
