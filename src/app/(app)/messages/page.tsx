'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/auth'
import { createClient } from '@/lib/supabase'
import { apiClient } from '@/lib/api-client'
import Avatar from '@/components/ui/Avatar'
import TopBar from '@/components/ui/TopBar'
import { MemberRowSkeleton } from '@/components/ui/Loading'
import { formatMessageTime, truncate } from '@/lib/utils'
import type { ConversationWithDetails } from '@/types'

export default function MessagesPage() {
  const { user } = useAuthStore()
  const router = useRouter()
  const [conversations, setConversations] = useState<ConversationWithDetails[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    loadConversations()

    // Subscribe to new messages in real time
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
  }, [user])

  async function loadConversations() {
    if (!user) return
    const response = await apiClient.get<ConversationWithDetails[]>('/api/conversations')
    if (response.data) {
      setConversations(response.data)
    }
    setLoading(false)
  }

  return (
    <div>
      <TopBar
        title="Messages"
        subtitle="Private · Members only"
        right={
          <button
            onClick={() => router.push('/messages/new')}
            className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-white/70"
            aria-label="New message"
          >
            <ComposeIcon />
          </button>
        }
      />

      {loading ? (
        <div className="space-y-px mt-1">
          {Array.from({ length: 5 }).map((_, i) => <MemberRowSkeleton key={i} />)}
        </div>
      ) : conversations.length === 0 ? (
        <div className="px-5 py-16 text-center">
          <p className="text-4xl mb-4">💬</p>
          <p className="font-serif text-xl text-green-900 mb-2">No messages yet</p>
          <p className="text-sm text-green-900/45 mb-6">
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
        <div className="space-y-px bg-green-50/50 pt-px">
          {conversations.map(conv => (
            <ConversationRow
              key={conv.id}
              conversation={conv}
              currentUserId={user?.id ?? ''}
            />
          ))}
        </div>
      )}
    </div>
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
    ?.filter(p => (p.member as any)?.id !== currentUserId)
    .map(p => p.member as any)
    ?? []

  const displayName = conv.type === 'group' && conv.name
    ? conv.name
    : others.map((m: any) => m.first_name).join(', ') || 'Unknown'

  const hasUnread = (conv.unread_count ?? 0) > 0
  const lastMsg = conv.last_message as any

  return (
    <Link
      href={`/messages/${conv.id}`}
      className="flex items-center gap-3 px-5 py-3.5 bg-white hover:bg-green-50/50 transition-colors"
    >
      {/* Avatar or group indicator */}
      {conv.type === 'group' ? (
        <div className="w-11 h-11 rounded-full bg-green-800 flex items-center justify-center text-gold text-lg flex-shrink-0 border border-gold/20">
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
          <span className={`text-sm ${hasUnread ? 'font-semibold text-green-900' : 'font-medium text-green-900/80'}`}>
            {displayName}
          </span>
          <span className="text-xs text-green-900/35 flex-shrink-0 ml-2">
            {lastMsg ? formatMessageTime(lastMsg.created_at) : ''}
          </span>
        </div>
        <p className={`text-xs truncate ${hasUnread ? 'text-green-900/70' : 'text-green-900/40'}`}>
          {lastMsg
            ? (lastMsg.sender_id === currentUserId ? 'You: ' : '') + truncate(lastMsg.body, 60)
            : 'No messages yet'}
        </p>
      </div>

      {/* Unread dot */}
      {hasUnread && (
        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: '#85bb65' }} />
      )}
    </Link>
  )
}

function ComposeIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
    </svg>
  )
}
