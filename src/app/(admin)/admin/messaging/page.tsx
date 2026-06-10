'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { apiClient } from '@/lib/api-client'
import { formatRelativeTime } from '@/lib/utils'
import {
  AdminPageHeader,
  AdminCard,
  AdminButton,
  Badge,
} from '@/components/admin/AdminUI'
import Avatar from '@/components/ui/Avatar'

interface MutedMember {
  id: string
  first_name: string
  last_name: string
  email: string
  messaging_muted_until: string
  profile: { avatar_url: string | null } | null
}

type RawRow = {
  id: string
  first_name: string
  last_name: string
  email: string
  messaging_muted_until: string
  profile: { avatar_url: string | null }[] | { avatar_url: string | null } | null
}

function toMutedMember(row: RawRow): MutedMember {
  const profile = Array.isArray(row.profile) ? (row.profile[0] ?? null) : row.profile
  return { ...row, profile }
}

const MUTE_DURATIONS = [
  { label: '1 hour',    hours: 1 },
  { label: '24 hours',  hours: 24 },
  { label: '7 days',    hours: 24 * 7 },
  { label: '30 days',   hours: 24 * 30 },
  { label: 'Permanent', hours: 24 * 365 * 10 },
] as const

type MuteDuration = typeof MUTE_DURATIONS[number]

export default function AdminMessagingPage() {
  const [muted, setMuted] = useState<MutedMember[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState<string | null>(null)

  // ---- Member search for quick-mute ---------------------------
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

    setMuted(((data ?? []) as unknown as RawRow[]).map(toMutedMember))
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
      setSearchResults(((data ?? []) as unknown as RawRow[]).map(toMutedMember))
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
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <AdminPageHeader
        title="Messaging Controls"
        description="Rate limits run automatically. Use manual mutes for persistent offenders."
      />

      {/* Rate limit info banner */}
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
          Limits reset automatically. Members hitting them receive a 429 response with a Retry-After
          header. Use manual mutes below for repeat offenders.
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
