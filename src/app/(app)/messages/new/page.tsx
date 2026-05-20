'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuthStore } from '@/store/auth'
import { apiClient } from '@/lib/api-client'
import Avatar from '@/components/ui/Avatar'
import { Spinner } from '@/components/ui/Loading'
import type { MemberWithProfile } from '@/types'

export default function NewConversationPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user } = useAuthStore()

  const preselectedId = searchParams.get('with')

  const [members, setMembers] = useState<MemberWithProfile[]>([])
  const [selected, setSelected] = useState<string[]>(preselectedId ? [preselectedId] : [])
  const [search, setSearch] = useState('')
  const [groupName, setGroupName] = useState('')
  const [creating, setCreating] = useState(false)
  const [loading, setLoading] = useState(true)

  const isGroup = selected.length > 1

  useEffect(() => {
    if (user) loadMembers()
  }, [user])

  async function loadMembers() {
    const response = await apiClient.get<MemberWithProfile[]>('/api/members?exclude_self=true')
    setMembers(response.data ?? [])
    setLoading(false)
  }

  function toggleMember(id: string) {
    setSelected(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    )
  }

  async function startConversation() {
    if (selected.length === 0 || !user || creating) return
    setCreating(true)

    const response = await apiClient.post<{ id: string }>('/api/conversations', {
      type: isGroup ? 'group' : 'direct',
      name: isGroup ? (groupName.trim() || null) : null,
      participant_ids: selected,
    })

    if (response.error || !response.data) {
      setCreating(false)
      return
    }

    router.push(`/messages/${response.data.id}`)
  }

  const filtered = members.filter(m => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return `${m.first_name} ${m.last_name}`.toLowerCase().includes(q) ||
      m.profile?.business_name?.toLowerCase().includes(q)
  })

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="top-bar flex items-center gap-3">
        <button onClick={() => router.push('/messages')} className="text-gold text-sm flex items-center gap-1">
          <BackArrow /> Cancel
        </button>
        <h1 className="flex-1 text-white font-medium text-sm text-center">New Message</h1>
        <button
          onClick={startConversation}
          disabled={selected.length === 0 || creating}
          className="text-sm font-semibold disabled:opacity-30"
          style={{ color: '#85bb65' }}
        >
          {creating ? <Spinner className="w-4 h-4 text-gold" /> : 'Start'}
        </button>
      </div>

      {/* Selected members */}
      {selected.length > 0 && (
        <div className="flex gap-2 px-4 py-3 flex-wrap bg-white border-b border-green-900/08">
          {selected.map(id => {
            const m = members.find(m => m.id === id)
            if (!m) return null
            return (
              <button
                key={id}
                onClick={() => toggleMember(id)}
                className="flex items-center gap-1.5 bg-green-100 text-green-900 rounded-full px-3 py-1 text-xs font-medium"
              >
                {m.first_name} {m.last_name}
                <span className="text-green-900/50 text-base leading-none">×</span>
              </button>
            )
          })}
        </div>
      )}

      {/* Group name input (shows when 2+ selected) */}
      {isGroup && (
        <div className="px-4 py-3 bg-white border-b border-green-900/08">
          <input
            type="text"
            placeholder="Group name (optional)…"
            value={groupName}
            onChange={e => setGroupName(e.target.value)}
            className="input text-sm"
          />
        </div>
      )}

      {/* Search */}
      <div className="px-4 py-3 border-b border-green-900/08 bg-white">
        <input
          type="search"
          placeholder="Search members…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="input text-sm"
          autoFocus={!preselectedId}
        />
      </div>

      {/* Member list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-8"><Spinner className="text-green-700" /></div>
        ) : filtered.length === 0 ? (
          <p className="text-center text-sm text-green-900/40 py-8 italic">No members found.</p>
        ) : (
          <div className="space-y-px bg-green-50/30">
            {filtered.map(m => {
              const isSelected = selected.includes(m.id)
              return (
                <button
                  key={m.id}
                  onClick={() => toggleMember(m.id)}
                  className="w-full flex items-center gap-3 px-5 py-3.5 bg-white hover:bg-green-50/50 transition-colors text-left"
                >
                  <Avatar
                    firstName={m.first_name}
                    lastName={m.last_name}
                    avatarUrl={m.profile?.avatar_url}
                    size="md"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-green-900">
                      {m.first_name} {m.last_name}
                    </p>
                    <p className="text-xs text-green-900/50 truncate mt-0.5">
                      {[m.profile?.role_title, m.profile?.business_name].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  {/* Selection indicator */}
                  <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                    isSelected
                      ? 'border-green-800 bg-green-800'
                      : 'border-green-900/20 bg-transparent'
                  }`}>
                    {isSelected && (
                      <svg className="w-3 h-3 text-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function BackArrow() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
    </svg>
  )
}
