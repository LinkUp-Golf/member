'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useProfile } from '@/hooks/useProfile'
import { createClient } from '@/lib/supabase'
import { apiClient } from '@/lib/api-client'
import { usePresence } from '@/hooks/usePresence'
import AppShell from '@/components/layout/AppShell'
import { MemberRowSkeleton } from '@/components/ui/Loading'
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

  const pendingInvites = conversations.filter(c => c.my_status === 'pending')
  const activeConversations = conversations.filter(c => c.my_status !== 'pending')

  const loadConversations = useCallback(async () => {
    if (!user) return
    const res = await apiClient.get<ConversationWithDetails[]>('/api/conversations')
    if (res.data) setConversations(res.data)
    setLoading(false)
  }, [user])

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
      end={
        <button
          onClick={() => router.push('/messages/new')}
          className="w-9 h-9 rounded-full flex items-center justify-center transition-colors"
          style={{ background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)' }}
          aria-label="New message"
        >
          <ComposeIcon />
        </button>
      }
    >
      {loading ? (
        <div className="pt-1">
          {Array.from({ length: 5 }).map((_, i) => <MemberRowSkeleton key={i} />)}
        </div>
      ) : pendingInvites.length === 0 && activeConversations.length === 0 ? (
        <EmptyInbox onCompose={() => router.push('/messages/new')} />
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
                  onRespond={() => loadConversations()}
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

function EmptyInbox({ onCompose }: { onCompose: () => void }) {
  return (
    <div className="px-5 py-16 text-center">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl mb-5 mx-auto"
        style={{ background: 'rgba(0,38,105,0.06)' }}
      >
        💬
      </div>
      <p className="font-sans font-black text-xl mb-2" style={{ color: 'var(--color-green-900)' }}>
        No messages yet
      </p>
      <p className="text-sm mb-7" style={{ color: 'rgba(0,38,105,0.42)' }}>
        Start a conversation with a fellow member.
      </p>
      <button onClick={onCompose} className="btn btn-primary">
        Start a conversation
      </button>
    </div>
  )
}

function ComposeIcon() {
  return (
    <svg style={{ width: '1.1rem', height: '1.1rem' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
    </svg>
  )
}
