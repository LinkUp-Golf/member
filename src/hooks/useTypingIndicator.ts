import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'

const STOP_DELAY_MS = 3000 // clear own typing indicator after 3 s of inactivity

interface TypingUser {
  userId: string
  name: string
}

// Broadcasts typing_start / typing_stop events over a Realtime broadcast channel.
// Returns the list of other users currently typing and helpers to trigger events.
export function useTypingIndicator(
  conversationId: string,
  currentUserId: string | null,
  currentUserName: string
) {
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([])
  const channelRef = useRef<RealtimeChannel | null>(null)
  const stopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!currentUserId || !conversationId) return

    const supabase = createClient()
    const channel = supabase.channel(`typing:${conversationId}`)

    channel
      .on('broadcast', { event: 'typing_start' }, ({ payload }: { payload: TypingUser }) => {
        if (payload.userId === currentUserId) return
        setTypingUsers(prev =>
          prev.find(u => u.userId === payload.userId)
            ? prev
            : [...prev, payload]
        )
      })
      .on('broadcast', { event: 'typing_stop' }, ({ payload }: { payload: { userId: string } }) => {
        setTypingUsers(prev => prev.filter(u => u.userId !== payload.userId))
      })
      .subscribe()

    channelRef.current = channel

    return () => {
      if (stopTimeoutRef.current) clearTimeout(stopTimeoutRef.current)
      supabase.removeChannel(channel)
      channelRef.current = null
      setTypingUsers([])
    }
  }, [conversationId, currentUserId])

  // Debounced: call on every keystroke. Automatically sends typing_stop after idle.
  const sendTyping = useCallback(() => {
    if (!channelRef.current || !currentUserId) return

    channelRef.current.send({
      type: 'broadcast',
      event: 'typing_start',
      payload: { userId: currentUserId, name: currentUserName },
    })

    if (stopTimeoutRef.current) clearTimeout(stopTimeoutRef.current)
    stopTimeoutRef.current = setTimeout(() => {
      channelRef.current?.send({
        type: 'broadcast',
        event: 'typing_stop',
        payload: { userId: currentUserId },
      })
    }, STOP_DELAY_MS)
  }, [currentUserId, currentUserName])

  // Call explicitly when the user sends a message so the indicator clears instantly.
  const stopTyping = useCallback(() => {
    if (!channelRef.current || !currentUserId) return
    if (stopTimeoutRef.current) clearTimeout(stopTimeoutRef.current)
    channelRef.current.send({
      type: 'broadcast',
      event: 'typing_stop',
      payload: { userId: currentUserId },
    })
  }, [currentUserId])

  return { typingUsers, sendTyping, stopTyping }
}
