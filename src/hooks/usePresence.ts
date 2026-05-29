import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'

// Tracks online presence for users in a shared channel (e.g. a conversation).
// Each user tracks their own session; the hook exposes a live Set of online user IDs.
export function usePresence(channelKey: string, currentUserId: string | null) {
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!currentUserId || !channelKey) return

    const supabase = createClient()
    const channel = supabase.channel(`presence:${channelKey}`, {
      config: { presence: { key: currentUserId } },
    })

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<{ online_at: string }>()
        setOnlineUserIds(new Set(Object.keys(state)))
      })
      .on('presence', { event: 'join' }, ({ key }) => {
        setOnlineUserIds(prev => new Set([...prev, key]))
      })
      .on('presence', { event: 'leave' }, ({ key }) => {
        setOnlineUserIds(prev => {
          const next = new Set(prev)
          next.delete(key)
          return next
        })
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ online_at: new Date().toISOString() })
        }
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [channelKey, currentUserId])

  const isOnline = useCallback(
    (userId: string) => onlineUserIds.has(userId),
    [onlineUserIds]
  )

  return { onlineUserIds, isOnline }
}
