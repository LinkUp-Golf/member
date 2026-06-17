'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import { apiClient } from '@/lib/api-client'
import { formatRelativeTime, truncate } from '@/lib/utils'
import {
  AdminPageHeader,
  AdminCard,
  AdminButton,
  Badge,
} from '@/components/admin/AdminUI'
import Avatar from '@/components/ui/Avatar'
import { Spinner, Skeleton } from '@/components/ui/Loading'

// ============================================================
// Shared types
// ============================================================

interface MutedMember {
  id: string
  first_name: string
  last_name: string
  email: string
  messaging_muted_until: string
  profile: { avatar_url: string | null } | null
}

type RawMutedRow = {
  id: string
  first_name: string
  last_name: string
  email: string
  messaging_muted_until: string
  profile: { avatar_url: string | null }[] | { avatar_url: string | null } | null
}

function toMutedMember(row: RawMutedRow): MutedMember {
  const profile = Array.isArray(row.profile) ? (row.profile[0] ?? null) : row.profile
  return { ...row, profile }
}

interface ConvParticipant {
  id: string
  first_name: string
  last_name: string
  email: string
  avatar_url: string | null
  status: string
}

interface ConvSummary {
  id: string
  type: 'direct' | 'group'
  name: string | null
  created_at: string
  updated_at: string
  message_count: number
  participants: ConvParticipant[]
  last_message: { body: string; sender_name: string; created_at: string } | null
}

interface AdminMessage {
  id: string
  body: string
  created_at: string
  edited_at: string | null
  deleted_at: string | null
  sender: {
    id: string
    first_name: string
    last_name: string
    profile: { avatar_url: string | null }[] | { avatar_url: string | null } | null
  } | null
}

const MUTE_DURATIONS = [
  { label: '3 hours',   hours: 3 },
  { label: '24 hours',  hours: 24 },
  { label: '7 days',    hours: 24 * 7 },
  { label: '30 days',   hours: 24 * 30 },
  { label: 'Permanent', hours: 24 * 365 * 10 },
] as const
type MuteDuration = typeof MUTE_DURATIONS[number]

// ============================================================
// Root page — tab switcher
// ============================================================

export default function AdminMessagingPage() {
  const [tab, setTab] = useState<'logs' | 'controls'>('logs')

  return (
    <div className="p-6">
      <AdminPageHeader
        title="Messaging"
        description="Browse message logs and manage spam controls."
      />

      {/* Tabs */}
      <div className="flex gap-1 mb-6 p-1 bg-gray-100 rounded-lg w-fit">
        {(['logs', 'controls'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors capitalize ${
              tab === t
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'logs' ? 'Message Logs' : 'Spam Controls'}
          </button>
        ))}
      </div>

      {tab === 'logs' ? <LogsTab /> : <ControlsTab />}
    </div>
  )
}

// ============================================================
// Conversation row skeleton
// ============================================================

function ConvRowSkeleton() {
  return (
    <div className="flex items-start gap-3 px-5 py-3.5 border-b border-gray-50 last:border-0">
      <Skeleton className="w-9 h-9 rounded-full flex-shrink-0 mt-0.5" />
      <div className="flex-1 space-y-2 min-w-0">
        <div className="flex justify-between gap-4">
          <Skeleton className="h-3.5 w-36" />
          <Skeleton className="h-3 w-10 flex-shrink-0" />
        </div>
        <Skeleton className="h-3 w-56" />
        <div className="flex gap-2">
          <Skeleton className="h-3 w-14 rounded-full" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
    </div>
  )
}

// ============================================================
// Logs tab
// ============================================================

function LogsTab() {
  const [convs, setConvs] = useState<ConvSummary[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'direct' | 'group'>('all')
  const [selected, setSelected] = useState<ConvSummary | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async (q: string, type: string, currentSelected: ConvSummary | null) => {
    setLoading(true)
    const params = new URLSearchParams({ type, limit: '30' })
    if (q) params.set('search', q)
    const res = await apiClient.get<{ conversations: ConvSummary[]; total: number }>(
      `/api/admin/messaging/conversations?${params}`
    )
    const list = res.data?.conversations ?? []
    setConvs(list)
    setTotal(res.data?.total ?? 0)
    setLoading(false)
    // Auto-select: keep current if still in list, else pick first
    if (list.length > 0) {
      const stillPresent = currentSelected && list.some(c => c.id === currentSelected.id)
      if (!stillPresent) setSelected(list[0] ?? null)
    } else {
      setSelected(null)
    }
  }, [])

  useEffect(() => { load('', 'all', null) }, [load])

  function handleSearch(val: string) {
    setSearch(val)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(
      () => load(val, typeFilter, selected),
      350
    )
  }

  function handleType(val: 'all' | 'direct' | 'group') {
    setTypeFilter(val)
    load(search, val, selected)
  }

  // On mobile: show thread panel as a full-screen overlay when a conversation is selected
  const showThreadMobile = selected !== null

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="search"
          placeholder="Search by member name or email…"
          value={search}
          onChange={e => handleSearch(e.target.value)}
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-green-500"
        />
        <div className="flex gap-1 p-1 bg-gray-100 rounded-lg self-start sm:self-auto">
          {(['all', 'direct', 'group'] as const).map(t => (
            <button
              key={t}
              onClick={() => handleType(t)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors capitalize ${
                typeFilter === t
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Two-column on md+; stacked/overlay on mobile */}
      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4 items-start">

        {/* ---- Conversation list ---- */}
        {/* Hide on mobile when a thread is open */}
        <div className={showThreadMobile ? 'hidden md:block' : ''}>
          <AdminCard>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-700">
                Conversations
                {!loading && (
                  <span className="ml-2 text-xs font-normal text-gray-400">({total})</span>
                )}
              </h2>
            </div>

            {loading ? (
              <div className="-mx-5 -mb-5">
                {Array.from({ length: 6 }).map((_, i) => <ConvRowSkeleton key={i} />)}
              </div>
            ) : convs.length === 0 ? (
              <div className="py-10 flex flex-col items-center text-center gap-2">
                <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center text-xl">
                  💬
                </div>
                <p className="text-sm font-medium text-gray-600">No conversations found</p>
                <p className="text-xs text-gray-400">
                  {search ? 'Try a different name or email.' : 'No messages have been sent yet.'}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50 -mx-5 -mb-5">
                {convs.map(conv => {
                  const isActive = selected?.id === conv.id
                  const displayName = conv.type === 'group' && conv.name
                    ? conv.name
                    : conv.participants.map(p => `${p.first_name} ${p.last_name}`).join(', ')

                  return (
                    <button
                      key={conv.id}
                      onClick={() => setSelected(conv)}
                      className={`w-full flex items-start gap-3 px-5 py-3.5 text-left transition-colors ${
                        isActive ? 'bg-green-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <div className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold mt-0.5 ${
                        conv.type === 'group'
                          ? 'bg-green-800 text-amber-300'
                          : 'bg-gray-200 text-gray-500'
                      }`}>
                        {conv.type === 'group' ? '#' : '↔'}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="text-sm font-medium text-gray-800 truncate capitalize">
                            {displayName}
                          </p>
                          <span className="text-[10px] text-gray-400 flex-shrink-0">
                            {formatRelativeTime(conv.updated_at)}
                          </span>
                        </div>
                        {conv.last_message ? (
                          <p className="text-xs text-gray-400 truncate mt-0.5">
                            <span className="font-medium capitalize">{conv.last_message.sender_name}:</span>{' '}
                            {truncate(conv.last_message.body, 60)}
                          </p>
                        ) : (
                          <p className="text-xs text-gray-300 mt-0.5 italic">No messages yet</p>
                        )}
                        <div className="flex items-center gap-2 mt-1">
                          <Badge label={conv.type} colour={conv.type === 'group' ? 'green' : 'gray'} />
                          <span className="text-[10px] text-gray-400">
                            {conv.message_count} msg{conv.message_count !== 1 ? 's' : ''}
                            {' · '}{conv.participants.length} member{conv.participants.length !== 1 ? 's' : ''}
                          </span>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </AdminCard>
        </div>

        {/* ---- Thread panel ---- */}
        {selected ? (
          <MessageThreadPanel
            conv={selected}
            onClose={() => setSelected(null)}
            showBackButton={showThreadMobile}
          />
        ) : (
          /* Placeholder shown on desktop when nothing auto-selected yet */
          <div className="hidden md:flex flex-col items-center justify-center py-16 text-center">
            <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center text-2xl mb-3">
              👈
            </div>
            <p className="text-sm font-medium text-gray-500">Select a conversation</p>
            <p className="text-xs text-gray-400 mt-1">Click any row on the left to view its messages.</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================
// Message thread panel
// ============================================================

function MessageThreadPanel({
  conv,
  onClose,
  showBackButton = false,
}: {
  conv: ConvSummary
  onClose: () => void
  showBackButton?: boolean
}) {
  const [messages, setMessages] = useState<AdminMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  const fetchMessages = useCallback(async (cursor?: string) => {
    const params = new URLSearchParams({ limit: '50' })
    if (cursor) params.set('before', cursor)
    const res = await apiClient.get<{ messages: AdminMessage[]; hasMore: boolean; nextCursor: string | null }>(
      `/api/admin/messaging/conversations/${conv.id}/messages?${params}`
    )
    return res.data
  }, [conv.id])

  useEffect(() => {
    setLoading(true)
    setMessages([])
    fetchMessages().then(data => {
      setMessages(data?.messages ?? [])
      setHasMore(data?.hasMore ?? false)
      setNextCursor(data?.nextCursor ?? null)
      setLoading(false)
    })
  }, [fetchMessages])

  async function loadMore() {
    if (!nextCursor) return
    setLoadingMore(true)
    const data = await fetchMessages(nextCursor)
    setMessages(prev => [...prev, ...(data?.messages ?? [])])
    setHasMore(data?.hasMore ?? false)
    setNextCursor(data?.nextCursor ?? null)
    setLoadingMore(false)
  }

  const displayName = conv.type === 'group' && conv.name
    ? conv.name
    : conv.participants.map(p => `${p.first_name} ${p.last_name}`).join(', ')

  return (
    <AdminCard>
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        {/* Back button — mobile only */}
        {showBackButton && (
          <button
            onClick={onClose}
            className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 md:hidden"
            aria-label="Back to conversations"
          >
            ‹
          </button>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-800 truncate capitalize">{displayName}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {conv.participants.length} participant{conv.participants.length !== 1 ? 's' : ''}
            {' · '}{conv.message_count} message{conv.message_count !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Participants */}
      <div className="flex flex-wrap gap-1.5 mb-4 pb-4 border-b border-gray-100">
        {conv.participants.map(p => (
          <div key={p.id} className="flex items-center gap-1.5 bg-gray-50 rounded-full pl-1 pr-2.5 py-1">
            <Avatar firstName={p.first_name} lastName={p.last_name}
              avatarUrl={p.avatar_url} size="sm" />
            <span className="text-xs text-gray-700 capitalize">{p.first_name} {p.last_name}</span>
            {p.status === 'pending' && <Badge label="invited" colour="gold" />}
          </div>
        ))}
      </div>

      {/* Messages */}
      <div className="max-h-[520px] overflow-y-auto space-y-1 -mx-5 px-5">
        {loading ? (
          <div className="flex justify-center py-8"><Spinner className="text-green-700" /></div>
        ) : messages.length === 0 ? (
          <p className="text-sm text-gray-400 py-6 text-center">No messages in this conversation.</p>
        ) : (
          <>
            {hasMore && (
              <div className="flex justify-center pb-2">
                <AdminButton
                  label={loadingMore ? 'Loading…' : 'Load older messages'}
                  variant="ghost"
                  size="sm"
                  onClick={loadMore}
                  disabled={loadingMore}
                />
              </div>
            )}
            {[...messages].reverse().map(msg => {
              const sender = msg.sender
              const avatarUrl = sender?.profile
                ? (Array.isArray(sender.profile) ? sender.profile[0]?.avatar_url : sender.profile.avatar_url) ?? null
                : null
              const isDeleted = !!msg.deleted_at
              const isEdited  = !!msg.edited_at && !isDeleted

              return (
                <div key={msg.id} className="flex items-start gap-2.5 py-1.5">
                  {sender ? (
                    <Avatar
                      firstName={sender.first_name}
                      lastName={sender.last_name}
                      avatarUrl={avatarUrl}
                      size="sm"
                    />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-gray-200 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-gray-800 capitalize">
                        {sender ? `${sender.first_name} ${sender.last_name}` : 'Unknown'}
                      </span>
                      <span className="text-[10px] text-gray-400">
                        {new Date(msg.created_at).toLocaleString()}
                      </span>
                      {isEdited  && <Badge label="edited"  colour="gray" />}
                      {isDeleted && <Badge label="deleted" colour="red"  />}
                    </div>
                    <p className={`text-sm mt-0.5 leading-snug break-words ${
                      isDeleted ? 'italic text-gray-400' : 'text-gray-700'
                    }`}>
                      {isDeleted ? '[message deleted]' : msg.body}
                    </p>
                  </div>
                </div>
              )
            })}
          </>
        )}
      </div>
    </AdminCard>
  )
}

// ============================================================
// Controls tab (spam controls — unchanged from original)
// ============================================================

function ControlsTab() {
  const [muted, setMuted] = useState<MutedMember[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<MutedMember[]>([])
  const [searching, setSearching] = useState(false)
  const [muteTarget, setMuteTarget] = useState<MutedMember | null>(null)
  const [muteDuration, setMuteDuration] = useState<MuteDuration>(MUTE_DURATIONS[1])

  const loadMuted = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('members')
      .select('id, first_name, last_name, email, messaging_muted_until, profile:member_profiles(avatar_url)')
      .not('messaging_muted_until', 'is', null)
      .gt('messaging_muted_until', new Date().toISOString())
      .order('messaging_muted_until', { ascending: true })

    setMuted(((data ?? []) as unknown as RawMutedRow[]).map(toMutedMember))
    setLoading(false)
  }, [])

  useEffect(() => { loadMuted() }, [loadMuted])

  useEffect(() => {
    if (!search.trim()) { setSearchResults([]); return }
    const timer = setTimeout(async () => {
      setSearching(true)
      const supabase = createClient()
      const q = search.trim().toLowerCase()
      const { data } = await supabase
        .from('members')
        .select('id, first_name, last_name, email, messaging_muted_until, profile:member_profiles(avatar_url)')
        .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%`)
        .order('first_name')
        .limit(8)
      setSearchResults(((data ?? []) as unknown as RawMutedRow[]).map(toMutedMember))
      setSearching(false)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  async function handleMute(memberId: string, hours: number) {
    setProcessing(memberId)
    const muteUntil = new Date(Date.now() + hours * 3_600_000).toISOString()
    const res = await apiClient.patch(
      `/api/admin/members/${memberId}/messaging-mute`,
      { muted_until: muteUntil }
    )
    setProcessing(null)
    if (!res.error) {
      setMuteTarget(null)
      setSearch('')
      setSearchResults([])
      await loadMuted()
    }
  }

  async function handleUnmute(memberId: string) {
    setProcessing(memberId)
    await apiClient.patch(`/api/admin/members/${memberId}/messaging-mute`, { muted_until: null })
    setProcessing(null)
    await loadMuted()
  }

  const isPermanent = (until: string) =>
    new Date(until).getFullYear() > new Date().getFullYear() + 5

  const isCurrentlyMuted = (m: MutedMember) =>
    !!m.messaging_muted_until && new Date(m.messaging_muted_until) > new Date()

  return (
    <div className="space-y-6">
      {/* Rate limit info */}
      <AdminCard>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Active Rate Limits</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { label: 'Messages / min',  value: '30 per member' },
            { label: 'Burst / 15 s',    value: '10 per conversation' },
            { label: 'Invites / hour',  value: '10 per member' },
          ].map(({ label, value }) => (
            <div key={label} className="bg-gray-50 rounded-lg px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-gray-400 mb-0.5">{label}</p>
              <p className="text-sm font-semibold text-gray-800">{value}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-3">
          Limits reset automatically. Members hitting them receive a 429 with a Retry-After header.
          Use manual mutes below for repeat offenders.
        </p>
      </AdminCard>

      {/* Quick-mute search */}
      <AdminCard>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Mute a Member</h2>
        <div className="space-y-3">
          <input
            type="search"
            placeholder="Search by name or email…"
            value={search}
            onChange={e => { setSearch(e.target.value); setMuteTarget(null) }}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-green-500"
          />
          {searching && <p className="text-xs text-gray-400">Searching…</p>}

          {searchResults.length > 0 && !muteTarget && (
            <div className="border border-gray-100 rounded-lg overflow-hidden divide-y divide-gray-50">
              {searchResults.map(m => (
                <button
                  key={m.id}
                  onClick={() => setMuteTarget(m)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 text-left transition-colors"
                >
                  <Avatar firstName={m.first_name} lastName={m.last_name}
                    avatarUrl={m.profile?.avatar_url} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 capitalize">
                      {m.first_name} {m.last_name}
                    </p>
                    <p className="text-xs text-gray-400 truncate">{m.email}</p>
                  </div>
                  {isCurrentlyMuted(m) && <Badge label="Muted" colour="red" />}
                </button>
              ))}
            </div>
          )}

          {muteTarget && (
            <div className="border border-gray-200 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-3">
                <Avatar firstName={muteTarget.first_name} lastName={muteTarget.last_name}
                  avatarUrl={muteTarget.profile?.avatar_url} size="sm" />
                <div>
                  <p className="text-sm font-semibold text-gray-800 capitalize">
                    {muteTarget.first_name} {muteTarget.last_name}
                  </p>
                  <p className="text-xs text-gray-400">{muteTarget.email}</p>
                </div>
                <button
                  onClick={() => { setMuteTarget(null); setSearch('') }}
                  className="ml-auto text-gray-400 hover:text-gray-600 text-lg leading-none"
                >×</button>
              </div>

              <div>
                <p className="text-xs font-medium text-gray-500 mb-2">Mute duration</p>
                <div className="flex flex-wrap gap-2">
                  {MUTE_DURATIONS.map(d => (
                    <button
                      key={d.label}
                      onClick={() => setMuteDuration(d)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        muteDuration.label === d.label
                          ? 'bg-green-800 text-white border-green-800'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-green-600'
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>

              <AdminButton
                label={processing === muteTarget.id ? 'Muting…' : `Mute for ${muteDuration.label}`}
                variant="danger"
                onClick={() => handleMute(muteTarget.id, muteDuration.hours)}
                disabled={processing === muteTarget.id}
              />
            </div>
          )}
        </div>
      </AdminCard>

      {/* Muted members list */}
      <AdminCard>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">
          Currently Muted
          {muted.length > 0 && (
            <span className="ml-2 text-xs font-normal text-gray-400">({muted.length})</span>
          )}
        </h2>

        {loading ? (
          <p className="text-sm text-gray-400 py-4 text-center">Loading…</p>
        ) : muted.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">No members are currently muted.</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {muted.map(m => (
              <div key={m.id} className="flex items-center gap-3 py-3">
                <Avatar firstName={m.first_name} lastName={m.last_name}
                  avatarUrl={m.profile?.avatar_url} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 capitalize">
                    {m.first_name} {m.last_name}
                  </p>
                  <p className="text-xs text-gray-400">
                    {isPermanent(m.messaging_muted_until)
                      ? 'Muted permanently'
                      : `Until ${new Date(m.messaging_muted_until).toLocaleString()}`
                    }
                    {!isPermanent(m.messaging_muted_until) && (
                      <> · {formatRelativeTime(m.messaging_muted_until)} remaining</>
                    )}
                  </p>
                </div>
                <AdminButton
                  label={processing === m.id ? '…' : 'Unmute'}
                  variant="ghost"
                  size="sm"
                  onClick={() => handleUnmute(m.id)}
                  disabled={processing === m.id}
                />
              </div>
            ))}
          </div>
        )}
      </AdminCard>
    </div>
  )
}
