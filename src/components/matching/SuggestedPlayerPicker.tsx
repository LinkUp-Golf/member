'use client'

// The Suggested tab when adding a player to a round: the members the LinkUp
// team recommended to this member, one tap each. Only the ones who can be
// added here — in the member list the booking draws from, and not already on
// the round. Picking one is the same as picking that member by name.

import { useMemo } from 'react'
import { Plus } from 'lucide-react'
import Avatar from '@/components/ui/Avatar'
import { Spinner } from '@/components/ui/Loading'
import { useRecommendations } from '@/hooks/useRecommendations'
import type { MemberWithProfile } from '@/types'

export default function SuggestedPlayerPicker({
  members,
  excludeIds,
  onSelect,
}: {
  members: MemberWithProfile[]
  excludeIds: string[]
  onSelect: (member: MemberWithProfile) => void
}) {
  const { recommendations, loaded } = useRecommendations()

  const options = useMemo(() => {
    const byId = new Map(members.map(m => [m.id, m]))
    const excluded = new Set(excludeIds)
    return recommendations.flatMap(r => {
      const member = byId.get(r.member.id)
      return member && !excluded.has(member.id) ? [{ rec: r, member }] : []
    })
  }, [recommendations, members, excludeIds])

  if (!loaded || members.length === 0) {
    return <div className="py-4 flex justify-center"><Spinner className="w-4 h-4" /></div>
  }

  if (options.length === 0) {
    return (
      <p className="text-xs leading-snug py-2" style={{ color: 'rgba(0,38,105,0.5)' }}>
        Everyone the LinkUp team suggested for you is already on this round.
      </p>
    )
  }

  return (
    <ul className="space-y-2">
      {options.map(({ rec, member }) => (
        <li key={rec.id}>
          <button
            type="button"
            onClick={() => onSelect(member)}
            className="focus-ring w-full flex items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors hover:bg-green-50/60"
            style={{ borderColor: 'rgba(0,38,105,0.1)' }}
          >
            <Avatar firstName={member.first_name} lastName={member.last_name} avatarUrl={member.profile?.avatar_url} size="sm" />
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-medium" style={{ color: 'var(--color-green-900)' }}>
                {rec.member.name}
              </span>
              {rec.note && (
                <span className="block text-xs leading-snug mt-0.5 line-clamp-2" style={{ color: 'rgba(0,38,105,0.5)' }}>
                  {rec.note}
                </span>
              )}
            </span>
            <Plus className="w-4 h-4 mt-1 flex-shrink-0" strokeWidth={2.25} style={{ color: 'var(--color-green-700)' }} aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  )
}
