import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import { apiClient } from '@/lib/api-client'
import type { MessageWithSender, OptimisticMessage } from '@/types'
import type { RealtimeChannel } from '@supabase/supabase-js'

const PAGE_SIZE = 30

interface PaginatedMessages {
  messages: MessageWithSender[]
  hasMore: boolean
  nextCursor: string | null
}

interface SenderProfile {
  firstName: string
  lastName: string
  avatarUrl: string | null
}

export function useMessages(conversationId: string, currentUserId: string | null) {
  const [messages, setMessages] = useState<OptimisticMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [cursor, setCursor] = useState<string | null>(null)

  const knownIds = useRef<Set<string>>(new Set())
  const channelRef = useRef<RealtimeChannel | null>(null)

  // ---- Helpers -----------------------------------------------

  const addMessage = useCallback((msg: MessageWithSender) => {
    if (knownIds.current.has(msg.id)) return
    knownIds.current.add(msg.id)
    setMessages(prev => [...prev, msg])
  }, [])

  // ---- Initial load ------------------------------------------
  const loadMessages = useCallback(async () => {
    if (!currentUserId) return
    setLoading(true)

    const res = await apiClient.get<PaginatedMessages>(
      `/api/conversations/${conversationId}/messages?limit=${PAGE_SIZE}`
    )

    if (res.data) {
      const msgs = res.data.messages
      setMessages(msgs)
      knownIds.current = new Set(msgs.map(m => m.id))
      setHasMore(res.data.hasMore)
      setCursor(res.data.nextCursor)
    }

    setLoading(false)
  }, [conversationId, currentUserId])

  // ---- Load older messages (infinite scroll) -----------------
  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return
    setLoadingMore(true)

    const res = await apiClient.get<PaginatedMessages>(
      `/api/conversations/${conversationId}/messages?limit=${PAGE_SIZE}&before=${encodeURIComponent(cursor)}`
    )

    if (res.data) {
      const older = res.data.messages.filter(m => !knownIds.current.has(m.id))
      older.forEach(m => knownIds.current.add(m.id))
      setMessages(prev => [...older, ...prev])
      setHasMore(res.data.hasMore)
      setCursor(res.data.nextCursor)
    }

    setLoadingMore(false)
  }, [conversationId, cursor, loadingMore])

  // ---- Optimistic send ---------------------------------------
  const sendMessage = useCallback(async (body: string, sender: SenderProfile): Promise<boolean> => {
    if (!currentUserId || !body.trim()) return false

    const tempId = `temp-${Date.now()}-${Math.random()}`
    const now = new Date().toISOString()

    const optimistic: OptimisticMessage = {
      id: tempId,
      tempId,
      conversation_id: conversationId,
      sender_id: currentUserId,
      body: body.trim(),
      created_at: now,
      edited_at: null,
      deleted_at: null,
      pending: true,
      failed: false,
      sender: {
        id: currentUserId,
        first_name: sender.firstName,
        last_name: sender.lastName,
        profile: { avatar_url: sender.avatarUrl },
      },
    }

    setMessages(prev => [...prev, optimistic])

    const res = await apiClient.post<MessageWithSender>(
      `/api/conversations/${conversationId}/messages`,
      { body: body.trim() }
    )

    if (res.error || !res.data) {
      setMessages(prev =>
        prev.map(m => m.tempId === tempId ? { ...m, pending: false, failed: true } : m)
      )
      return false
    }

    // Replace optimistic with the confirmed message
    const confirmed = res.data
    knownIds.current.add(confirmed.id)
    setMessages(prev =>
      prev.map(m => m.tempId === tempId ? { ...confirmed, pending: false, failed: false } : m)
    )

    // Broadcast to the channel so the other participant receives it immediately,
    // bypassing any RLS issues with postgres_changes delivery.
    channelRef.current?.send({
      type: 'broadcast',
      event: 'new_message',
      payload: res.data,
    })

    return true
  }, [conversationId, currentUserId])

  // ---- Retry a failed message --------------------------------
  const retryMessage = useCallback(async (tempId: string, body: string, sender: SenderProfile) => {
    setMessages(prev => prev.filter(m => m.tempId !== tempId))
    return sendMessage(body, sender)
  }, [sendMessage])

  // ---- Realtime subscription ---------------------------------
  // Primary: broadcast (fast, no RLS dependency)
  // Backup:  postgres_changes (works once RLS fix migration is applied)
  useEffect(() => {
    if (!currentUserId) return

    loadMessages()

    const supabase = createClient()

    const channel = supabase
      .channel(`conversation:${conversationId}`)
      // Primary: receive messages broadcast by the sender after their API call succeeds
      .on('broadcast', { event: 'new_message' }, ({ payload }) => {
        const msg = payload as MessageWithSender
        // Skip our own sends — already handled by the optimistic → confirmed swap
        if (msg.sender_id === currentUserId) return
        addMessage(msg)
      })
      // Backup: postgres CDC for cases where broadcast wasn't sent
      // (e.g. sender on another device / tab, or a future server-side trigger)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      }, async (payload) => {
        const newId = payload.new.id as string
        if (knownIds.current.has(newId)) return

        // Fetch the full row with sender join via the API (uses admin client server-side)
        const res = await apiClient.get<{ messages: MessageWithSender[] }>(
          `/api/conversations/${conversationId}/messages?limit=1&before=${encodeURIComponent(
            new Date(Date.now() + 1000).toISOString()
          )}`
        )
        const msg = res.data?.messages.find(m => m.id === newId)
        if (msg) addMessage(msg)
      })
      .subscribe()

    channelRef.current = channel

    return () => {
      supabase.removeChannel(channel)
      channelRef.current = null
    }
  }, [conversationId, currentUserId, loadMessages, addMessage])

  return {
    messages,
    loading,
    loadingMore,
    hasMore,
    loadMore,
    sendMessage,
    retryMessage,
  }
}
