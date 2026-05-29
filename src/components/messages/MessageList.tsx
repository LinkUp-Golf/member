'use client'

import { useEffect, useRef } from 'react'
import { MessageBubble } from './MessageBubble'
import { TypingIndicator } from './TypingIndicator'
import type { OptimisticMessage } from '@/types'

interface Props {
  messages: OptimisticMessage[]
  currentUserId: string
  isGroup?: boolean
  // Maps other participant user IDs → their last_read_at timestamp
  otherParticipantsReadAt?: Record<string, string | null>
  typingNames?: string[]
  loadingMore?: boolean
  hasMore?: boolean
  onLoadMore?: () => void
}

export function MessageList({
  messages,
  currentUserId,
  isGroup,
  otherParticipantsReadAt = {},
  typingNames = [],
  loadingMore,
  hasMore,
  onLoadMore,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const topSentinelRef = useRef<HTMLDivElement>(null)
  const isFirstMount = useRef(true)
  const prevMessageCount = useRef(messages.length)

  // Scroll to bottom on initial load
  useEffect(() => {
    if (isFirstMount.current && messages.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: 'instant' })
      isFirstMount.current = false
    }
  }, [messages.length])

  // Scroll to bottom when a new message arrives (but not when loading older ones)
  useEffect(() => {
    const added = messages.length - prevMessageCount.current
    prevMessageCount.current = messages.length

    if (isFirstMount.current || added <= 0) return

    const container = bottomRef.current?.parentElement
    if (!container) return

    const { scrollTop, scrollHeight, clientHeight } = container
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight

    // Auto-scroll only if the user is within 150 px of the bottom
    if (distanceFromBottom < 150) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages.length])

  // Infinite-scroll sentinel: fire onLoadMore when the top sentinel enters the viewport
  useEffect(() => {
    if (!hasMore || !onLoadMore) return
    const sentinel = topSentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) onLoadMore() },
      { threshold: 0.1 }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, onLoadMore])

  // Determine the last confirmed (non-pending) message sent by me that others have seen
  const lastConfirmedByMe = [...messages]
    .reverse()
    .find(m => m.sender_id === currentUserId && !m.pending && !m.failed && !m.tempId)

  const lastSeenId = lastConfirmedByMe
    ? (() => {
        const readTimestamps = Object.values(otherParticipantsReadAt).filter(Boolean) as string[]
        const wasSeen = readTimestamps.some(
          readAt => new Date(readAt) >= new Date(lastConfirmedByMe.created_at)
        )
        return wasSeen ? lastConfirmedByMe.id : null
      })()
    : null

  const grouped = groupByDate(messages)

  return (
    <div className="flex flex-col min-h-full">
      {/* Top sentinel for infinite scroll */}
      {hasMore && <div ref={topSentinelRef} className="h-px" />}

      {loadingMore && (
        <div className="flex justify-center py-3">
          <div className="w-4 h-4 border-2 border-green-700/25 border-t-green-700 rounded-full animate-spin" />
        </div>
      )}

      {grouped.map(({ date, messages: dayMsgs }) => (
        <div key={date}>
          <div className="divider-label my-2">{date}</div>
          {dayMsgs.map((msg, i) => {
            const isMe = msg.sender_id === currentUserId
            const prevMsg = dayMsgs[i - 1]
            const nextMsg = dayMsgs[i + 1]
            // Show avatar/name on the first bubble in a consecutive run from the same sender
            const showSenderInfo = i === 0 || prevMsg?.sender_id !== msg.sender_id
            // "Seen" label only on the last confirmed message from me that was read
            const isSeen = isMe && msg.id === lastSeenId
            // Collapse bottom margin when next bubble is from the same sender
            const isSameRunContinues = !!nextMsg && nextMsg.sender_id === msg.sender_id

            return (
              <div key={msg.id} className={isSameRunContinues ? 'mb-0.5' : 'mb-2'}>
                <MessageBubble
                  message={msg}
                  isMe={isMe}
                  showSenderInfo={showSenderInfo}
                  isSeen={isSeen}
                  isGroup={isGroup}
                />
              </div>
            )
          })}
        </div>
      ))}

      {typingNames.length > 0 && (
        <div className="mt-1">
          <TypingIndicator names={typingNames} />
        </div>
      )}

      {/* Scroll anchor */}
      <div ref={bottomRef} />
    </div>
  )
}

// ---- Helpers -------------------------------------------------

function groupByDate(messages: OptimisticMessage[]) {
  const groups: { date: string; messages: OptimisticMessage[] }[] = []
  let currentDate = ''

  for (const msg of messages) {
    const date = formatDateLabel(msg.created_at)
    if (date !== currentDate) {
      currentDate = date
      groups.push({ date, messages: [] })
    }
    groups[groups.length - 1]!.messages.push(msg)
  }

  return groups
}

function formatDateLabel(iso: string): string {
  const date = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)

  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}
