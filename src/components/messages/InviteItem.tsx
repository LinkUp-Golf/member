'use client'

import { useState } from 'react'
import { apiClient } from '@/lib/api-client'
import type { ConversationWithDetails } from '@/types'

interface Props {
  conversation: ConversationWithDetails
  currentUserId: string
  onRespond: (conversationId: string) => void
}

export function InviteItem({ conversation: conv, currentUserId, onRespond }: Props) {
  const [loading, setLoading] = useState<'accept' | 'decline' | null>(null)

  const inviter = conv.participants.find(
    p => p.member.id !== currentUserId && p.status === 'active'
  )?.member ?? conv.participants.find(p => p.member.id !== currentUserId)?.member

  const groupName = conv.name ?? 'Group chat'
  const memberCount = conv.participants.length

  async function respond(action: 'accept' | 'decline') {
    setLoading(action)
    await apiClient.post(`/api/conversations/${conv.id}/respond`, { action })
    setLoading(null)
    onRespond(conv.id)
  }

  return (
    <div
      className="flex items-start gap-3.5 px-5 py-4 bg-white"
      style={{ borderBottom: '1px solid rgba(0,38,105,0.06)' }}
    >
      {/* Group avatar */}
      <div className="flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center text-lg font-serif"
        style={{ background: 'var(--color-green-800)', color: 'var(--color-gold)', border: '2px solid rgba(133,187,101,0.2)' }}
      >
        #
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-green-900 truncate">{groupName}</p>

        <p className="text-xs mt-0.5 mb-3" style={{ color: 'rgba(0,38,105,0.5)' }}>
          {inviter
            ? <>{inviter.first_name} {inviter.last_name} invited you · {memberCount} member{memberCount !== 1 ? 's' : ''}</>
            : <>{memberCount} member{memberCount !== 1 ? 's' : ''}</>
          }
        </p>

        <div className="flex gap-2">
          <button
            onClick={() => respond('accept')}
            disabled={loading !== null}
            className="flex-1 py-1.5 rounded-xl text-xs font-semibold transition-opacity disabled:opacity-50"
            style={{ background: 'var(--color-green-800)', color: '#fff' }}
          >
            {loading === 'accept' ? 'Accepting…' : 'Accept'}
          </button>
          <button
            onClick={() => respond('decline')}
            disabled={loading !== null}
            className="flex-1 py-1.5 rounded-xl text-xs font-semibold border transition-opacity disabled:opacity-50"
            style={{ borderColor: 'rgba(0,38,105,0.15)', color: 'rgba(0,38,105,0.6)', background: 'transparent' }}
          >
            {loading === 'decline' ? 'Declining…' : 'Decline'}
          </button>
        </div>
      </div>

      {/* Invite badge */}
      <div
        className="flex-shrink-0 mt-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
        style={{ background: 'rgba(212,174,89,0.15)', color: 'var(--color-gold)' }}
      >
        Invited
      </div>
    </div>
  )
}
