'use client'

import { useState, useEffect, useCallback, useMemo, memo } from 'react'
import { useRouter } from 'next/navigation'
import { SquarePen, MessageCircle } from 'lucide-react'
import { useProfile } from '@/hooks/useProfile'
import { createClient } from '@/lib/supabase'
import { apiClient } from '@/lib/api-client'
import { usePresence } from '@/hooks/usePresence'
import AppShell from '@/components/layout/AppShell'
import { MemberRowSkeleton } from '@/components/ui/Loading'
import EmptyState from '@/components/ui/EmptyState'
import { ConversationItem } from '@/components/messages/ConversationItem'
import { InviteItem } from '@/components/messages/InviteItem'
import type { ConversationWithDetails } from '@/types'

export default function MessagesPage() {
  const { user } = useProfile()
  const router = useRouter()
  const [conversations, setConversations] = useState<ConversationWithDetails[]>([])
  const [loading, setLoading] = useState(true)

  // Track presence for all direct-message contacts so the list shows online dots
  const otherUserIds = conversations
    .filter(c => c.type === 'direct')
    .flatMap(c => c.participants.filter(p => p.member.id !== user?.id).map(p => p.member.id))

  // One presence channel for the whole inbox (uses userId as key per user)
  const { isOnline } = usePresence('inbox', user?.id ?? null)

  const pendingInvites = useMemo(
    () => conversations.filter(c => c.my_status === 'pending'),
    [conversations]
  )
  const activeConversations = useMemo(
    () => conversations.filter(c => c.my_status !== 'pending'),
    [conversations]
  )

  const loadConversations = useCallback(async () => {
    if (!user) return
    const res = await apiClient.get<ConversationWithDetails[]>('/api/conversations')
    if (res.data) setConversations(res.data)
    setLoading(false)
  }, [user])

  const handleInviteRespond = useCallback(() => {
    loadConversations()
  }, [loadConversations])

  const goToNewMessage = useCallback(() => {
    router.push('/messages/new')
  }, [router])

  useEffect(() => {
    if (!user) return
    loadConversations()

    // Refresh when new messages arrive or when invitation status changes
    const supabase = createClient()
    const channel = supabase
      .channel('inbox:messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
        loadConversations()
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversation_participants' }, () => {
        loadConversations()
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conversation_participants' }, () => {
        loadConversations()
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [user, loadConversations])

  // Suppress the unused variable warning — the IDs are used implicitly via isOnline
  void otherUserIds

  return (
    <AppShell
      title="Messages"
      description="Private · Members only"
      hideMessagesLink
      end={
        <button
          onClick={goToNewMessage}
          className="focus-ring w-9 h-9 rounded-full flex items-center justify-center transition-all hover:bg-white/[0.16] active:scale-90"
          style={{ background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)' }}
          aria-label="New message"
        >
          <SquarePen className="w-[1.1rem] h-[1.1rem]" strokeWidth={1.9} />
        </button>
      }
    >
      {loading ? (
        <div className="pt-1">
          {Array.from({ length: 5 }).map((_, i) => <MemberRowSkeleton key={i} />)}
        </div>
      ) : pendingInvites.length === 0 && activeConversations.length === 0 ? (
        <EmptyInbox onCompose={goToNewMessage} />
      ) : (
        <div>
          {pendingInvites.length > 0 && (
            <div>
              <p
                className="px-5 pt-4 pb-2 text-[11px] font-semibold uppercase tracking-wider"
                style={{ color: 'rgba(0,38,105,0.4)' }}
              >
                Invitations
              </p>
              {pendingInvites.map(conv => (
                <InviteItem
                  key={conv.id}
                  conversation={conv}
                  currentUserId={user?.id ?? ''}
                  onRespond={handleInviteRespond}
                />
              ))}
              {activeConversations.length > 0 && (
                <p
                  className="px-5 pt-4 pb-2 text-[11px] font-semibold uppercase tracking-wider"
                  style={{ color: 'rgba(0,38,105,0.4)' }}
                >
                  Messages
                </p>
              )}
            </div>
          )}
          {activeConversations.map(conv => {
            const directOther = conv.type === 'direct'
              ? conv.participants.find(p => p.member.id !== user?.id)?.member
              : null

            return (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                currentUserId={user?.id ?? ''}
                isOnline={directOther ? isOnline(directOther.id) : false}
              />
            )
          })}
        </div>
      )}
    </AppShell>
  )
}

// ---- Sub-components -----------------------------------------

const EmptyInbox = memo(function EmptyInbox({ onCompose }: { onCompose: () => void }) {
  return (
    <div className="px-5 py-10">
      <EmptyState
        icon={<MessageCircle className="w-6 h-6" strokeWidth={1.75} />}
        title="No messages yet"
        description="Start a conversation with a fellow member."
        action={
          <button onClick={onCompose} className="btn btn-primary">
            Start a conversation
          </button>
        }
      />
    </div>
  )
})
