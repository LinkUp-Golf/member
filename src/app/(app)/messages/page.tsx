'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/auth'
import { createClient } from '@/lib/supabase'
import { apiClient } from '@/lib/api-client'
import Avatar from '@/components/ui/Avatar'
import AppShell from '@/components/layout/AppShell'
import { MemberRowSkeleton } from '@/components/ui/Loading'
import { formatMessageTime, truncate, capitalizeName } from '@/lib/utils'
import type { ConversationWithDetails } from '@/types'

export default function MessagesPage() {
  const { user } = useAuthStore()
  const router = useRouter()
  const [conversations, setConversations] = useState<ConversationWithDetails[]>([])
  const [loading, setLoading] = useState(true)

  const loadConversations = useCallback(async () => {
    if (!user) return
    const response = await apiClient.get<ConversationWithDetails[]>('/api/conversations')
    if (response.data) {
      setConversations(response.data)
    }
    setLoading(false)
  }, [user])

  useEffect(() => {
    if (!user) return
    loadConversations()

    const supabase = createClient()
    const channel = supabase
      .channel('messages-list')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
      }, () => {
        loadConversations()
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [user, loadConversations])

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
      ) : conversations.length === 0 ? (
        <div className="px-5 py-16 text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl mb-5 mx-auto"
            style={{ background: 'rgba(0,38,105,0.06)' }}>
            💬
          </div>
          <p className="font-serif text-xl mb-2" style={{ color: 'var(--color-green-900)' }}>
            No messages yet
          </p>
          <p className="text-sm mb-7" style={{ color: 'rgba(0,38,105,0.42)' }}>
            Start a conversation with a fellow member.
          </p>
          <button
            onClick={() => router.push('/messages/new')}
            className="btn btn-primary"
          >
            Start a conversation
          </button>
        </div>
      ) : (
        <div className="divide-y" style={{ '--tw-divide-opacity': 1 } as React.CSSProperties}>
          {conversations.map(conv => (
            <ConversationRow
              key={conv.id}
              conversation={conv}
              currentUserId={user?.id ?? ''}
            />
          ))}
        </div>
      )}
    </AppShell>
  )
}

// ---- Conversation row ---------------------------------------

function ConversationRow({
  conversation: conv,
  currentUserId,
}: {
  conversation: ConversationWithDetails
  currentUserId: string
}) {
  const others = conv.participants
    ?.filter(p => p.member?.id !== currentUserId)
    .map(p => p.member)
    ?? []

  const displayName = conv.type === 'group' && conv.name
    ? conv.name
    : others.map(m => capitalizeName(m.first_name)).join(', ') || 'Unknown'

  const hasUnread = (conv.unread_count ?? 0) > 0
  const lastMsg = conv.last_message

  return (
    <Link
      href={`/messages/${conv.id}`}
      className="flex items-center gap-3.5 px-5 py-4 bg-white transition-colors"
      style={{ borderBottomColor: 'rgba(0,38,105,0.06)' }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-green-50)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'white')}
    >
      {/* Avatar or group indicator */}
      {conv.type === 'group' ? (
        <div className="w-11 h-11 rounded-full flex items-center justify-center text-lg font-serif flex-shrink-0"
          style={{ background: 'var(--color-green-800)', color: 'var(--color-gold)', border: '2px solid rgba(133,187,101,0.2)' }}>
          #
        </div>
      ) : others[0] ? (
        <Avatar
          firstName={others[0].first_name}
          lastName={others[0].last_name}
          avatarUrl={others[0].profile?.avatar_url}
          size="md"
        />
      ) : (
        <div className="avatar avatar-md">?</div>
      )}

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-sm" style={{
            color: 'var(--color-green-900)',
            fontWeight: hasUnread ? 600 : 500,
          }}>
            {displayName}
          </span>
          <span className="text-[10px] flex-shrink-0 ml-2" style={{ color: 'rgba(0,38,105,0.32)' }}>
            {lastMsg ? formatMessageTime(lastMsg.created_at) : ''}
          </span>
        </div>
        <p className="text-xs truncate" style={{
          color: hasUnread ? 'rgba(0,38,105,0.65)' : 'rgba(0,38,105,0.38)',
          fontWeight: hasUnread ? 500 : 400,
        }}>
          {lastMsg
            ? (lastMsg.sender_id === currentUserId ? 'You: ' : '') + truncate(lastMsg.body, 60)
            : 'No messages yet'}
        </p>
      </div>

      {/* Unread indicator */}
      {hasUnread && (
        <div className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ background: 'var(--color-gold)' }} />
      )}
    </Link>
  )
}

function ComposeIcon() {
  return (
    <svg className="w-4.5 h-4.5" style={{ width: '1.1rem', height: '1.1rem' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
    </svg>
  )
}
