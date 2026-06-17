'use client'

import { useEffect, useRef, useState } from 'react'
import Avatar from '@/components/ui/Avatar'
import { Spinner } from '@/components/ui/Loading'
import { RateLimitBanner } from '@/components/ui/RateLimitModal'
import { apiClient } from '@/lib/api-client'
import type { GroupParticipant, MemberWithProfile, ParticipantRole, ParticipantStatus } from '@/types'

interface Props {
  conversationId: string
  currentUserId: string
  isModerator: boolean
  open: boolean
  onClose: () => void
  /** Current group name — pre-fills the name input */
  conversationName?: string | null
  /** Called after a successful name save so the parent can refresh */
  onNameChange?: () => void
}

export function GroupMembersPanel({
  conversationId,
  currentUserId,
  isModerator,
  open,
  onClose,
  conversationName,
  onNameChange,
}: Props) {
  const [participants, setParticipants] = useState<GroupParticipant[]>([])
  const [loading, setLoading] = useState(false)
  const [actionFor, setActionFor] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // ---- Add member state -------------------------------------
  const [addOpen, setAddOpen] = useState(false)
  const [allMembers, setAllMembers] = useState<MemberWithProfile[]>([])
  const [memberSearch, setMemberSearch] = useState('')
  const [adding, setAdding] = useState<string | null>(null)
  const [blocked, setBlocked] = useState<{ title: string; message: string } | null>(null)

  // ---- Group name editing (moderators only) ------------------
  const [nameValue, setNameValue] = useState(conversationName ?? '')
  const [nameSaving, setNameSaving] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)

  // Sync external name into local state when the panel opens
  useEffect(() => {
    if (open) setNameValue(conversationName ?? '')
  }, [open, conversationName])

  async function handleNameSave() {
    const trimmed = nameValue.trim()
    if (trimmed === (conversationName ?? '')) return // no change
    setNameSaving(true)
    setNameError(null)
    const res = await apiClient.patch<{ name: string | null }>(
      `/api/conversations/${conversationId}`,
      { name: trimmed }
    )
    setNameSaving(false)
    if (res.error) {
      setNameError('Failed to save. Please try again.')
    } else {
      onNameChange?.()
    }
  }

  function handleNameKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.currentTarget.blur(); handleNameSave() }
    if (e.key === 'Escape') { setNameValue(conversationName ?? '') }
  }

  // ---- Slide animation state ---------------------------------
  // `mounted` keeps the DOM nodes alive during the exit transition.
  // `visible` drives the CSS classes that actually move the panel.
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (open) {
      setMounted(true)
      // Double rAF: first ensures the DOM node exists, second ensures it's
      // been painted in its off-screen position before we start the transition.
      const ids: number[] = []
      ids[0] = requestAnimationFrame(() => {
        ids[1] = requestAnimationFrame(() => setVisible(true))
      })
      return () => ids.forEach(id => cancelAnimationFrame(id))
    } else {
      setVisible(false)
      const t = setTimeout(() => setMounted(false), 320)
      return () => clearTimeout(t)
    }
  }, [open])

  // ---- Data loading ------------------------------------------
  useEffect(() => {
    if (!open) return
    setLoading(true)
    apiClient
      .get<GroupParticipant[]>(`/api/conversations/${conversationId}/participants`)
      .then(res => {
        setParticipants(res.data ?? [])
        setLoading(false)
      })
    // Pre-fetch all members once the panel opens so add-member search is instant
    apiClient
      .get<MemberWithProfile[]>('/api/members?exclude_self=true')
      .then(res => setAllMembers(res.data ?? []))
  }, [open, conversationId])

  async function handleAddMember(memberId: string) {
    setAdding(memberId)
    const res = await apiClient.post(
      `/api/conversations/${conversationId}/participants`,
      { member_id: memberId }
    )
    setAdding(null)
    if (res.status === 403) {
      setBlocked({ title: 'Messaging Restricted', message: 'The app anti-spam setting limits users to messaging and invite thresholds. You have exceeded this threshhold. You will be able to message and invite again in 3 hours.' })
      return
    }
    if (res.status === 429) {
      setBlocked({ title: 'Limit Reached', message: res.error?.message ?? 'Too many invitations. Please try again later.' })
      return
    }
    if (!res.error) {
      // Refresh participant list and close search
      const updated = await apiClient.get<GroupParticipant[]>(
        `/api/conversations/${conversationId}/participants`
      )
      setParticipants(updated.data ?? [])
      setAddOpen(false)
      setMemberSearch('')
    }
  }

  // Close action menu on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setActionFor(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  async function handleRoleChange(memberId: string, role: ParticipantRole) {
    setActionFor(null)
    const res = await apiClient.patch(
      `/api/conversations/${conversationId}/participants/${memberId}`,
      { role }
    )
    if (!res.error) {
      setParticipants(prev =>
        prev.map(p => p.member.id === memberId ? { ...p, role } : p)
      )
    }
  }

  async function handleRemove(memberId: string) {
    setActionFor(null)
    const res = await apiClient.delete(
      `/api/conversations/${conversationId}/participants/${memberId}`
    )
    if (!res.error) {
      setParticipants(prev => prev.filter(p => p.member.id !== memberId))
    }
  }

  if (!mounted) return null

  return (
    <>
      {/* Backdrop — fades in/out */}
      <button
        className={[
          'fixed inset-0 z-40 w-full cursor-default bg-black/30',
          visible ? 'opacity-100' : 'opacity-0',
        ].join(' ')}
        style={{ transition: 'opacity 200ms ease-out', willChange: 'opacity' }}
        onClick={onClose}
        aria-label="Close panel"
        tabIndex={-1}
      />

      {/* Outer — handles the slide transform only, no overflow-hidden here to
          avoid iOS Safari clipping the element mid-animation */}
      <div
        className={[
          'fixed inset-x-0 bottom-0 z-50',
          visible ? 'translate-y-0' : 'translate-y-full',
        ].join(' ')}
        style={{
          transition: visible
            ? 'transform 340ms cubic-bezier(0.32,0.72,0,1)'
            : 'transform 240ms cubic-bezier(0.4,0,1,1)',
          willChange: 'transform',
        }}
      >
      {/* Inner — clips rounded corners and constrains height */}
      <div
        className="max-h-[75vh] flex flex-col rounded-t-2xl overflow-hidden"
        style={{ background: '#FAFAF7' }}
      >
        {/* Handle + header */}
        <div className="flex-shrink-0">
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 rounded-full bg-green-900/20" />
          </div>
          <div className="flex items-center justify-between px-5 py-3 border-b border-green-900/08">
            <h2 className="text-sm font-semibold text-green-900">
              Members · {participants.length}
            </h2>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-full text-green-900/50 hover:bg-green-100 text-lg leading-none"
            >
              ×
            </button>
          </div>
          {blocked && <RateLimitBanner title={blocked.title} message={blocked.message} onClose={() => setBlocked(null)} />}
        </div>

        {/* Group name — moderators only */}
        {isModerator && (
          <div className="px-5 py-4 border-b border-green-900/08">
            <label htmlFor="group-name-input" className="block text-xs font-medium text-green-900/50 mb-1.5">
              Group name
            </label>
            <input
              id="group-name-input"
              type="text"
              value={nameValue}
              onChange={e => { setNameValue(e.target.value); setNameError(null) }}
              onBlur={handleNameSave}
              onKeyDown={handleNameKeyDown}
              maxLength={100}
              placeholder="Enter a group name…"
              disabled={nameSaving}
              className="w-full text-sm rounded-xl px-3.5 py-2.5 outline-none border border-green-900/15 focus:border-green-600 bg-white text-green-900 placeholder:text-green-900/30 transition-colors disabled:opacity-50"
            />
            {nameSaving && (
              <p className="text-[11px] text-green-900/40 mt-1">Saving…</p>
            )}
            {nameError && (
              <p className="text-[11px] text-red-500 mt-1">{nameError}</p>
            )}
          </div>
        )}

        {/* Add member — moderators only */}
        {isModerator && (
          <div className="border-b border-green-900/08">
            {addOpen ? (
              <div className="px-5 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <input
                    type="search"
                    placeholder="Search members…"
                    value={memberSearch}
                    onChange={e => setMemberSearch(e.target.value)}
                    autoFocus
                    className="flex-1 text-sm rounded-xl px-3 py-2 outline-none border border-green-900/15 focus:border-green-600 bg-white text-green-900 placeholder:text-green-900/30"
                  />
                  <button
                    onClick={() => { setAddOpen(false); setMemberSearch('') }}
                    className="w-7 h-7 flex items-center justify-center rounded-full text-green-900/40 hover:bg-green-100 text-lg leading-none"
                  >
                    ×
                  </button>
                </div>
                {/* Filtered member results */}
                <div className="max-h-48 overflow-y-auto rounded-xl border border-green-900/10 bg-white">
                  {(() => {
                    const existingIds = new Set(participants.map(p => p.member.id))
                    const filtered = allMembers.filter(m => {
                      if (existingIds.has(m.id)) return false
                      if (!memberSearch.trim()) return true
                      const q = memberSearch.toLowerCase()
                      return `${m.first_name} ${m.last_name}`.toLowerCase().includes(q) ||
                        m.profile?.business_name?.toLowerCase().includes(q)
                    })
                    if (!filtered.length) {
                      return (
                        <p className="px-4 py-3 text-xs text-green-900/40 text-center">
                          {allMembers.length === 0 ? 'Loading…' : 'No members to add'}
                        </p>
                      )
                    }
                    return filtered.map(m => (
                      <button
                        key={m.id}
                        onClick={() => handleAddMember(m.id)}
                        disabled={adding === m.id}
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-green-50 transition-colors text-left disabled:opacity-50 border-b border-green-900/05 last:border-0"
                      >
                        <Avatar
                          firstName={m.first_name}
                          lastName={m.last_name}
                          avatarUrl={m.profile?.avatar_url}
                          size="sm"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-green-900 capitalize truncate">
                            {m.first_name} {m.last_name}
                          </p>
                          {m.profile?.business_name && (
                            <p className="text-xs text-green-900/40 truncate">{m.profile.business_name}</p>
                          )}
                        </div>
                        {adding === m.id && <Spinner className="w-4 h-4 text-green-700 flex-shrink-0" />}
                      </button>
                    ))
                  })()}
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAddOpen(true)}
                className="w-full flex items-center gap-3 px-5 py-3 text-sm font-medium hover:bg-green-50 transition-colors text-left"
                style={{ color: 'var(--color-green-800)' }}
              >
                <span className="w-8 h-8 rounded-full flex items-center justify-center text-lg flex-shrink-0"
                  style={{ background: 'rgba(133,187,101,0.12)' }}>
                  +
                </span>
                Add member
              </button>
            )}
          </div>
        )}

        {/* Member list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-8">
              <Spinner className="text-green-700" />
            </div>
          ) : (
            <div className="py-2">
              {participants.map(p => {
                const isMe = p.member.id === currentUserId
                const isMod = p.role === 'moderator'
                const showActions = isModerator && !isMe

                return (
                  <div
                    key={p.member.id}
                    className="flex items-center gap-3 px-5 py-3"
                  >
                    <Avatar
                      firstName={p.member.first_name}
                      lastName={p.member.last_name}
                      avatarUrl={p.member.profile?.avatar_url}
                      size="md"
                    />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-green-900 capitalize">
                          {p.member.first_name} {p.member.last_name}
                          {isMe && (
                            <span className="text-green-900/40 font-normal"> (you)</span>
                          )}
                        </p>
                        {isMod && (
                          <span
                            className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                            style={{ background: 'rgba(133,187,101,0.15)', color: '#3a6e1f' }}
                          >
                            Moderator
                          </span>
                        )}
                        {(p as GroupParticipant & { status?: ParticipantStatus }).status === 'pending' && (
                          <span
                            className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                            style={{ background: 'rgba(212,174,89,0.15)', color: '#9a7a2a' }}
                          >
                            Invited
                          </span>
                        )}
                      </div>
                    </div>

                    {/* 3-dot action menu — moderators only, not for self */}
                    {showActions && (
                      <div
                        className="relative flex-shrink-0"
                        ref={actionFor === p.member.id ? menuRef : undefined}
                      >
                        <button
                          onClick={() =>
                            setActionFor(prev => prev === p.member.id ? null : p.member.id)
                          }
                          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-green-100 text-green-900/40"
                        >
                          <DotsVertical />
                        </button>

                        {actionFor === p.member.id && (
                          <div
                            className="absolute right-0 top-9 w-48 rounded-xl shadow-lg overflow-hidden z-10 border border-green-900/08"
                            style={{ background: '#fff' }}
                          >
                            {isMod ? (
                              <ActionItem
                                label="Remove moderator"
                                onClick={() => handleRoleChange(p.member.id, 'member')}
                              />
                            ) : (
                              <ActionItem
                                label="Make moderator"
                                onClick={() => handleRoleChange(p.member.id, 'moderator')}
                              />
                            )}
                            <ActionItem
                              label="Remove from group"
                              danger
                              onClick={() => handleRemove(p.member.id)}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>{/* /inner clip */}
      </div>{/* /outer slide */}
    </>
  )
}

function ActionItem({
  label,
  danger,
  onClick,
}: {
  label: string
  danger?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-3 text-sm hover:bg-green-50 transition-colors"
      style={{ color: danger ? '#dc2626' : '#1a2e1a' }}
    >
      {label}
    </button>
  )
}

function DotsVertical() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
      <circle cx="12" cy="5" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="19" r="1.5" />
    </svg>
  )
}
