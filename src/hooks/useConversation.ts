import { useState, useEffect, useCallback } from 'react'
import { apiClient } from '@/lib/api-client'
import type { ConversationWithDetails } from '@/types'

// Fetches and manages a single conversation's metadata (type, name, participants).
// Also provides markAsRead to update last_read_at.
export function useConversation(conversationId: string, currentUserId: string | null) {
  const [conversation, setConversation] = useState<ConversationWithDetails | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!currentUserId) return
    const res = await apiClient.get<ConversationWithDetails>(
      `/api/conversations/${conversationId}`
    )
    if (res.data) setConversation(res.data)
    setLoading(false)
  }, [conversationId, currentUserId])

  const markAsRead = useCallback(async () => {
    if (!currentUserId) return
    await apiClient.patch(`/api/conversations/${conversationId}/read`, {})
    // Optimistically clear unread badge in local state
    setConversation(prev => prev ? { ...prev, unread_count: 0 } : prev)
  }, [conversationId, currentUserId])

  useEffect(() => {
    load()
  }, [load])

  return { conversation, loading, markAsRead, reload: load }
}
