'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { useProfile } from '@/hooks/useProfile'
import { capitalizeName } from '@/lib/utils'
import AppShell from '@/components/layout/AppShell'
import Avatar from '@/components/ui/Avatar'
import { Spinner } from '@/components/ui/Loading'
import { MessageList } from '@/components/messages/MessageList'
import { MessageInput } from '@/components/messages/MessageInput'
import { PresenceIndicator } from '@/components/messages/PresenceIndicator'
import { GroupMembersPanel } from '@/components/messages/GroupMembersPanel'
import { useMessages } from '@/hooks/useMessages'
import { useConversation } from '@/hooks/useConversation'
import { usePresence } from '@/hooks/usePresence'
import { useTypingIndicator } from '@/hooks/useTypingIndicator'

export default function ChatPage() {
  const { id } = useParams<{ id: string }>()
  const { user, profile } = useProfile()

  const { conversation, loading: convLoading, markAsRead, reload } = useConversation(id, user?.id ?? null)

  const {
    messages,
    loading: msgsLoading,
    loadingMore,
    hasMore,
    loadMore,
    sendMessage,
    retryMessage,
    editMessage,
    deleteMessage,
  } = useMessages(id, user?.id ?? null)

  const { isOnline } = usePresence(id, user?.id ?? null)

  const currentUserName = profile ? capitalizeName(profile.first_name) : ''

  const { typingUsers, sendTyping, stopTyping } = useTypingIndicator(
    id,
    user?.id ?? null,
    currentUserName
  )

  const [membersOpen, setMembersOpen] = useState(false)

  const [navHeight, setNavHeight] = useState(0)
  const inputBarRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const measure = () => {
      const nav = document.querySelector('.bottom-nav')
      if (nav) setNavHeight(nav.getBoundingClientRect().height)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  useEffect(() => {
    if (user && messages.length > 0) markAsRead()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, user?.id])

  // ---- Derived display values --------------------------------
  const otherParticipants =
    conversation?.participants.filter(p => p.member?.id !== user?.id) ?? []

  const headerParticipant =
    conversation?.type === 'direct' ? otherParticipants[0] ?? null : null

  const convName =
    conversation?.type === 'group' && conversation.name
      ? conversation.name
      : otherParticipants.map(p => capitalizeName(p.member?.first_name ?? '')).join(', ') || '…'

  const isOtherOnline = headerParticipant ? isOnline(headerParticipant.member?.id ?? '') : false

  const otherReadAt = Object.fromEntries(
    otherParticipants.filter(p => p.member?.id).map(p => [p.member.id, p.last_read_at])
  )

  const typingNames = typingUsers.map(u => u.name)

  // Whether the current user is a moderator in this group conversation
  const myParticipant = conversation?.participants.find(p => p.member?.id === user?.id)
  const isModerator = conversation?.type === 'group' && myParticipant?.role === 'moderator'

  // ---- Handlers ----------------------------------------------
  async function handleSend(body: string) {
    return sendMessage(body, {
      firstName: profile?.first_name ?? '',
      lastName: profile?.last_name ?? '',
      avatarUrl: profile?.profile?.avatar_url ?? null,
    })
  }

  function handleRetry(tempId: string, body: string) {
    retryMessage(tempId, body, {
      firstName: profile?.first_name ?? '',
      lastName: profile?.last_name ?? '',
      avatarUrl: profile?.profile?.avatar_url ?? null,
    })
  }

  const isLoading = convLoading || msgsLoading

  return (
    <>
      <AppShell
        header={
          <div className="top-bar flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {/* Avatar with presence dot */}
              <div className="relative flex-shrink-0">
                {headerParticipant?.member ? (
                  <Avatar
                    firstName={headerParticipant.member.first_name}
                    lastName={headerParticipant.member.last_name}
                    avatarUrl={headerParticipant.member.profile?.avatar_url}
                    size="sm"
                  />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-green-700 flex items-center justify-center text-gold text-sm font-serif">
                    #
                  </div>
                )}
                {conversation?.type === 'direct' && (
                  <div className="absolute -bottom-0.5 -right-0.5">
                    <PresenceIndicator online={isOtherOnline} />
                  </div>
                )}
              </div>

              {/* Name + status */}
              <div className="min-w-0">
                <p className="text-sm font-black text-white truncate">{convName}</p>
                <p className="text-xs text-white/40">
                  {conversation?.type === 'direct'
                    ? isOtherOnline ? 'Online' : 'Offline'
                    : `${conversation?.participants.length ?? 0} members`}
                </p>
              </div>
            </div>

            {/* Group settings button — group chats only */}
            {conversation?.type === 'group' && (
              <button
                onClick={() => setMembersOpen(true)}
                className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                aria-label="Group settings"
              >
                <SettingsIcon />
              </button>
            )}
          </div>
        }
      >
        <div
          className="px-4 pt-4 min-h-full"
          style={{ background: '#F4F1E8', paddingBottom: navHeight + 80 }}
        >
          {isLoading ? (
            <div className="flex justify-center pt-8">
              <Spinner className="text-green-700" />
            </div>
          ) : messages.length === 0 ? (
            <EmptyState name={convName} />
          ) : (
            <MessageList
              messages={messages}
              currentUserId={user?.id ?? ''}
              isGroup={conversation?.type === 'group'}
              isModerator={isModerator}
              otherParticipantsReadAt={otherReadAt}
              typingNames={typingNames}
              loadingMore={loadingMore}
              hasMore={hasMore}
              onLoadMore={loadMore}
              onEdit={editMessage}
              onDelete={deleteMessage}
              onRetry={handleRetry}
            />
          )}
        </div>

        <div
          ref={inputBarRef}
          className="fixed left-0 right-0 z-30 md:left-[var(--sidebar-width)] lg:left-[var(--sidebar-width-lg)]"
          style={{ bottom: navHeight }}
        >
          <MessageInput
            placeholder={
              conversation?.type === 'group'
                ? 'Message group…'
                : `Message ${capitalizeName(headerParticipant?.member?.first_name ?? '')}…`
            }
            onSend={handleSend}
            onTypingStart={sendTyping}
            onTypingStop={stopTyping}
          />
        </div>
      </AppShell>

      {/* Group members panel */}
      {conversation?.type === 'group' && user?.id && (
        <GroupMembersPanel
          conversationId={id}
          currentUserId={user.id}
          isModerator={!!isModerator}
          open={membersOpen}
          onClose={() => setMembersOpen(false)}
          conversationName={conversation.name}
          onNameChange={reload}
        />
      )}
    </>
  )
}

// ---- Sub-components -----------------------------------------

function EmptyState({ name }: { name: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center py-16">
      <div
        className="w-14 h-14 rounded-full flex items-center justify-center mb-4 text-2xl"
        style={{ background: 'rgba(0,38,105,0.06)' }}
      >
        💬
      </div>
      <p className="text-sm font-medium text-green-900/60 mb-1">Start the conversation</p>
      <p className="text-xs text-green-900/35 italic">Say hello to {name}</p>
    </div>
  )
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
      />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}
