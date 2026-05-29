import Avatar from '@/components/ui/Avatar'
import { capitalizeName, formatMessageTime } from '@/lib/utils'
import type { OptimisticMessage } from '@/types'

interface Props {
  message: OptimisticMessage
  isMe: boolean
  // Show sender avatar + name above the bubble (first message in a consecutive run)
  showSenderInfo: boolean
  // Show "Seen" indicator below this bubble (last delivered message from me that was read)
  isSeen?: boolean
  // Show group sender name (only relevant for group conversations)
  isGroup?: boolean
}

export function MessageBubble({ message: msg, isMe, showSenderInfo, isSeen, isGroup }: Props) {
  const isDeleted = !!msg.deleted_at

  return (
    <div className={`flex items-end gap-2 mb-1 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar column (other side only) */}
      {!isMe && (
        <div className="w-7 flex-shrink-0 self-end mb-1">
          {showSenderInfo && !isDeleted && (
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

      {/* Bubble + meta */}
      <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} max-w-[75%]`}>
        {/* Sender name (group chats, first message in run) */}
        {showSenderInfo && !isMe && isGroup && (
          <p className="text-xs text-green-900/40 mb-0.5 ml-1">
            {capitalizeName(msg.sender.first_name)}
          </p>
        )}

        {/* Message body */}
        <div
          className={[
            'bubble',
            isDeleted
              ? 'bubble-deleted italic opacity-50'
              : isMe
              ? `bubble-out ${msg.pending ? 'opacity-60' : msg.failed ? '!bg-red-100 !text-red-700' : ''}`
              : 'bubble-in',
          ].join(' ')}
        >
          {isDeleted ? 'Message deleted' : msg.body}
        </div>

        {/* Timestamp + delivery status */}
        <div className={`flex items-center gap-1 mt-0.5 ${isMe ? 'flex-row-reverse mr-1' : 'ml-1'}`}>
          <span className="text-[10px] text-green-900/30">
            {formatMessageTime(msg.created_at)}
          </span>
          {isMe && msg.failed && (
            <span className="text-[10px] text-red-500">Failed · Tap to retry</span>
          )}
          {isMe && msg.pending && (
            <span className="text-[10px] text-green-900/30">Sending…</span>
          )}
          {isMe && isSeen && !msg.pending && !msg.failed && (
            <span className="text-[10px] text-green-600">Seen</span>
          )}
        </div>
      </div>
    </div>
  )
}
