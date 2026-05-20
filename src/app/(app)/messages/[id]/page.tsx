'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/auth'
import { createClient } from '@/lib/supabase'
import { apiClient } from '@/lib/api-client'
import Avatar from '@/components/ui/Avatar'
import AppShell from '@/components/layout/AppShell'
import { Spinner } from '@/components/ui/Loading'
import { formatMessageTime } from '@/lib/utils'
import type { Message } from '@/types'

interface MessageWithSender extends Message {
  sender: {
    id: string
    first_name: string
    last_name: string
    profile: { avatar_url: string | null } | null
  }
}

interface Participant {
  id: string
  first_name: string
  last_name: string
  profile: { avatar_url: string | null } | null
}

export default function ChatPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { user } = useAuthStore()

  const [messages, setMessages] = useState<MessageWithSender[]>([])
  const [participants, setParticipants] = useState<Participant[]>([])
  const [convName, setConvName] = useState('')
  const [convType, setConvType] = useState<'direct' | 'group'>('direct')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const markAsRead = useCallback(async () => {
    await apiClient.patch(`/api/conversations/${id}/read`, {})
  }, [id])

  const loadConversation = useCallback(async () => {
    const response = await apiClient.get<{ messages: MessageWithSender[]; participants: Participant[]; type: 'direct' | 'group'; name: string | null }>(`/api/conversations/${id}/messages`)

    if (response.error || !response.data) { router.push('/messages'); return }

    const { messages: msgs, participants: parts, type, name } = response.data

    setConvType(type)
    setParticipants(parts)

    if (type === 'group' && name) {
      setConvName(name)
    } else {
      const others = parts.filter(p => p.id !== user?.id)
      setConvName(others.map(p => `${p.first_name} ${p.last_name}`).join(', '))
    }

    setMessages(msgs)
    setLoading(false)
  }, [id, user, router])

  useEffect(() => {
    if (!user || !id) return
    loadConversation()
    markAsRead()

    // Subscribe to real-time messages
    const supabase = createClient()
    const channel = supabase
      .channel(`chat-${id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${id}`,
      }, async (payload) => {
        // Fetch the new message with sender info
        const { data } = await supabase
          .from('messages')
          .select('*, sender:members(id, first_name, last_name, profile:member_profiles(avatar_url))')
          .eq('id', payload.new.id)
          .single()

        if (data) {
          setMessages(prev => [...prev, data as MessageWithSender])
          markAsRead()
        }
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [user, id, loadConversation, markAsRead])

  // Scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function sendMessage() {
    if (!body.trim() || !user || sending) return
    const text = body.trim()
    setBody('')
    setSending(true)

    const response = await apiClient.post(`/api/conversations/${id}/messages`, { body: text })

    if (response.error) {
      console.error('Send error:', response.error)
      setBody(text) // restore on error
    }
    setSending(false)
    inputRef.current?.focus()
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const otherParticipants = participants.filter(p => p.id !== user?.id)
  const headerParticipant = convType === 'direct' ? otherParticipants[0] : null

  return (
    <AppShell
      header={
        <div className="top-bar flex items-center gap-3">
          <button
            onClick={() => router.push('/messages')}
            className="flex items-center gap-1 text-gold text-sm"
          >
            <BackArrow />
          </button>

          {headerParticipant ? (
            <Avatar
              firstName={headerParticipant.first_name}
              lastName={headerParticipant.last_name}
              avatarUrl={headerParticipant.profile?.avatar_url}
              size="sm"
            />
          ) : (
            <div className="w-9 h-9 rounded-full bg-green-700 flex items-center justify-center text-gold text-sm">#</div>
          )}

          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">{convName}</p>
            {convType === 'group' && (
              <p className="text-xs text-white/40">
                {participants.length} members
              </p>
            )}
            {convType === 'direct' && headerParticipant && (
              <p className="text-xs text-white/40">Active member</p>
            )}
          </div>

          {/* View profile shortcut for direct messages */}
          {convType === 'direct' && headerParticipant && (
            <button
              onClick={() => router.push(`/members/${headerParticipant.id}`)}
              className="text-white/40 text-xs"
            >
              Profile
            </button>
          )}
        </div>
      }
    >
      <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3" style={{ background: '#F4F1E8' }}>
        {loading ? (
          <div className="flex justify-center pt-8">
            <Spinner className="text-green-700" />
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-green-900/40 italic">
              Start the conversation below.
            </p>
          </div>
        ) : (
          <MessageList
            messages={messages}
            currentUserId={user?.id ?? ''}
          />
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="flex items-center gap-2 px-4 py-3 bg-white border-t border-green-900/08">
        <input
          ref={inputRef}
          type="text"
          placeholder={`Message ${convType === 'group' ? 'group' : headerParticipant?.first_name ?? ''}…`}
          value={body}
          onChange={e => setBody(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 bg-green-50 border border-green-900/10 rounded-full px-4 py-2 text-sm text-green-900 placeholder-green-900/35 outline-none"
          autoComplete="off"
        />
        <button
          onClick={sendMessage}
          disabled={!body.trim() || sending}
          className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-colors disabled:opacity-40"
          style={{ background: '#002669' }}
          aria-label="Send message"
        >
          {sending ? (
            <Spinner className="text-gold w-4 h-4" />
          ) : (
            <SendIcon />
          )}
        </button>
      </div>
      </div>
    </AppShell>
  )
}

// ---- Message list with date grouping ------------------------

function MessageList({ messages, currentUserId }: { messages: MessageWithSender[]; currentUserId: string }) {
  const grouped = groupByDate(messages)

  return (
    <>
      {grouped.map(({ date, messages: dayMsgs }) => (
        <div key={date}>
          <div className="divider-label my-2">{date}</div>
          {dayMsgs.map((msg, i) => {
            const isMe = msg.sender_id === currentUserId
            const showAvatar = !isMe && (i === 0 || dayMsgs[i - 1]?.sender_id !== msg.sender_id)
            return (
              <MessageBubble
                key={msg.id}
                message={msg}
                isMe={isMe}
                showAvatar={showAvatar}
              />
            )
          })}
        </div>
      ))}
    </>
  )
}

function MessageBubble({
  message: msg,
  isMe,
  showAvatar,
}: {
  message: MessageWithSender
  isMe: boolean
  showAvatar: boolean
}) {
  return (
    <div className={`flex items-end gap-2 mb-1 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar placeholder for alignment */}
      {!isMe && (
        <div className="w-7 flex-shrink-0">
          {showAvatar && (
            <Avatar
              firstName={msg.sender.first_name}
              lastName={msg.sender.last_name}
              avatarUrl={msg.sender.profile?.avatar_url}
              size="sm"
              className="w-7 h-7 text-xs"
            />
          )}
        </div>
      )}

      <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} max-w-[75%]`}>
        {showAvatar && !isMe && (
          <p className="text-xs text-green-900/40 mb-1 ml-1">
            {msg.sender.first_name}
          </p>
        )}
        <div className={`bubble ${isMe ? 'bubble-out' : 'bubble-in'}`}>
          {msg.body}
        </div>
        <p className={`text-xs text-green-900/30 mt-1 ${isMe ? 'mr-1' : 'ml-1'}`}>
          {formatMessageTime(msg.created_at)}
        </p>
      </div>
    </div>
  )
}

// ---- Helpers ------------------------------------------------

function groupByDate(messages: MessageWithSender[]) {
  const groups: { date: string; messages: MessageWithSender[] }[] = []
  let currentDate = ''

  for (const msg of messages) {
    const date = formatDateLabel(msg.created_at)
    if (date !== currentDate) {
      currentDate = date
      groups.push({ date, messages: [] })
    }
    groups[groups.length - 1]?.messages.push(msg)
  }

  return groups
}

function formatDateLabel(dateString: string): string {
  const date = new Date(dateString)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)

  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

// ---- Icons --------------------------------------------------
function BackArrow() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
    </svg>
  )
}

function SendIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: '#85bb65' }}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
    </svg>
  )
}
