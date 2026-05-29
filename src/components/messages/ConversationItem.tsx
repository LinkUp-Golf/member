import Link from 'next/link'
import Avatar from '@/components/ui/Avatar'
import { PresenceIndicator } from './PresenceIndicator'
import { formatMessageTime, truncate, capitalizeName } from '@/lib/utils'
import type { ConversationWithDetails } from '@/types'

interface Props {
  conversation: ConversationWithDetails
  currentUserId: string
  isOnline?: boolean
}

export function ConversationItem({ conversation: conv, currentUserId, isOnline }: Props) {
  const others = conv.participants
    .filter(p => p.member?.id !== currentUserId)
    .map(p => p.member)
    .filter(Boolean) as NonNullable<typeof conv.participants[0]['member']>[]

  const displayName =
    conv.type === 'group' && conv.name
      ? conv.name
      : others.map(m => capitalizeName(m.first_name)).join(', ') || 'Unknown'

  const hasUnread = (conv.unread_count ?? 0) > 0
  const lastMsg = conv.last_message
  const isDirect = conv.type === 'direct'
  const other = isDirect ? others[0] : null

  return (
    <Link
      href={`/messages/${conv.id}`}
      className="flex items-center gap-3.5 px-5 py-4 bg-white hover:bg-green-50 transition-colors"
      style={{ borderBottom: '1px solid rgba(0,38,105,0.06)' }}
    >
      {/* Avatar */}
      <div className="relative flex-shrink-0">
        {conv.type === 'group' ? (
          <div
            className="w-11 h-11 rounded-full flex items-center justify-center text-lg font-serif"
            style={{ background: 'var(--color-green-800)', color: 'var(--color-gold)', border: '2px solid rgba(133,187,101,0.2)' }}
          >
            #
          </div>
        ) : other ? (
          <Avatar
            firstName={other.first_name}
            lastName={other.last_name}
            avatarUrl={other.profile?.avatar_url}
            size="md"
          />
        ) : (
          <div className="avatar avatar-md">?</div>
        )}
        {isDirect && (
          <div className="absolute -bottom-0.5 -right-0.5">
            <PresenceIndicator online={!!isOnline} />
          </div>
        )}
      </div>

      {/* Text content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between mb-0.5">
          <span
            className="text-sm truncate"
            style={{
              color: 'var(--color-green-900)',
              fontWeight: hasUnread ? 600 : 500,
            }}
          >
            {displayName}
          </span>
          <span className="text-[10px] flex-shrink-0 ml-2" style={{ color: 'rgba(0,38,105,0.32)' }}>
            {lastMsg ? formatMessageTime(lastMsg.created_at) : ''}
          </span>
        </div>
        <p
          className="text-xs truncate"
          style={{
            color: hasUnread ? 'rgba(0,38,105,0.65)' : 'rgba(0,38,105,0.38)',
            fontWeight: hasUnread ? 500 : 400,
          }}
        >
          {lastMsg
            ? (lastMsg.sender_id === currentUserId ? 'You: ' : '') + truncate(lastMsg.body, 60)
            : 'No messages yet'}
        </p>
      </div>

      {/* Unread dot */}
      {hasUnread && (
        <div
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ background: 'var(--color-gold)' }}
        />
      )}
    </Link>
  )
}
