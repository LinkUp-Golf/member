'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'

export interface MemberDetail {
  id: string
  first_name: string
  last_name: string
  email: string
  profile: {
    display_name: string
    avatar_url: string | null
    business_name: string | null
    role_title: string | null
    handicap_index: number | null
    show_handicap: boolean
    industry_category: string | null
    value_offered: string | null
    preferred_play_times: string | null
    play_frequency: string | null
    open_to_golf_travel: boolean
    non_golf_hobbies: string | null
  } | null
}

export default function MemberProfileSheet({
  memberId,
  onClose,
}: {
  memberId: string | null
  onClose: () => void
}) {
  const [detail, setDetail] = useState<MemberDetail | null>(null)
  const [hasPlayedWith, setHasPlayedWith] = useState(false)
  const [focusGroups, setFocusGroups] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (memberId) {
      setDetail(null)
      setHasPlayedWith(false)
      setFocusGroups([])
      setMounted(true)
      setLoading(true)
      fetch(`/api/members/${memberId}`)
        .then(r => r.json())
        .then(d => {
          setDetail(d.member ?? null)
          setHasPlayedWith(!!d.hasPlayedWith)
          setFocusGroups(Array.isArray(d.focusLinkupGroups) ? d.focusLinkupGroups : [])
        })
        .catch(() => {})
        .finally(() => setLoading(false))
      return
    }
    setVisible(false)
    const t = setTimeout(() => { setMounted(false); setDetail(null) }, 320)
    return () => clearTimeout(t)
  }, [memberId])

  useEffect(() => {
    if (!mounted) return
    const ids: number[] = []
    ids[0] = requestAnimationFrame(() => {
      ids[1] = requestAnimationFrame(() => setVisible(true))
    })
    return () => ids.forEach(id => cancelAnimationFrame(id))
  }, [mounted])

  if (!mounted) return null

  const prof = detail?.profile
  const displayName = prof?.display_name || (detail ? `${detail.first_name} ${detail.last_name}`.trim() : '')
  const initials = detail ? `${detail.first_name[0] ?? ''}${detail.last_name[0] ?? ''}`.toUpperCase() : '?'
  const avatarUrl = prof?.avatar_url ?? null

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end md:justify-center md:items-center md:p-6">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 w-full h-full"
        style={{ background: 'rgba(0,0,0,0.45)', opacity: visible ? 1 : 0, transition: 'opacity 200ms ease-out' }}
        onClick={onClose}
      />
      <div
        className="relative bg-white rounded-t-3xl md:rounded-3xl pt-5 pb-8 w-full md:max-w-md"
        style={{
          boxShadow: '0 -4px 32px rgba(0,0,0,0.12)',
          transform: visible ? 'translateY(0)' : 'translateY(100%)',
          transition: visible
            ? 'transform 340ms cubic-bezier(0.32,0.72,0,1)'
            : 'transform 240ms cubic-bezier(0.4,0,1,1)',
          willChange: 'transform',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div className="flex justify-center mb-4 flex-shrink-0">
          <div className="w-10 h-1 rounded-full" style={{ background: 'rgba(0,38,105,0.12)' }} />
        </div>

        {loading ? (
          <div className="flex flex-col items-center py-10 gap-3 px-5">
            <div className="w-16 h-16 rounded-2xl animate-pulse" style={{ background: 'rgba(0,38,105,0.08)' }} />
            <div className="w-36 h-3.5 rounded-full animate-pulse" style={{ background: 'rgba(0,38,105,0.08)' }} />
            <div className="w-24 h-2.5 rounded-full animate-pulse" style={{ background: 'rgba(0,38,105,0.06)' }} />
            <div className="w-full h-16 rounded-2xl animate-pulse mt-2" style={{ background: 'rgba(0,38,105,0.05)' }} />
          </div>
        ) : (
          <div className="overflow-y-auto flex-1 px-5 space-y-4">
            {/* Header */}
            <div className="flex items-start gap-4">
              {avatarUrl ? (
                <Image
                  src={avatarUrl} alt="" width={60} height={60}
                  className="rounded-2xl object-cover flex-shrink-0"
                  style={{ width: 60, height: 60 }}
                />
              ) : (
                <div
                  className="rounded-2xl flex items-center justify-center text-xl font-bold flex-shrink-0"
                  style={{ width: 60, height: 60, background: 'rgba(133,187,101,0.15)', color: 'var(--color-green-700)' }}
                >
                  {initials}
                </div>
              )}
              <div className="flex-1 min-w-0 pt-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-sans font-black text-lg leading-tight" style={{ color: 'var(--color-green-900)' }}>
                    {displayName}
                  </p>
                  {hasPlayedWith && (
                    <span
                      className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
                      style={{ background: 'rgba(133,187,101,0.15)', color: 'var(--color-green-700)' }}
                    >
                      Played before
                    </span>
                  )}
                </div>
                {prof?.role_title && (
                  <p className="text-sm mt-0.5" style={{ color: 'rgba(0,38,105,0.55)' }}>{prof.role_title}</p>
                )}
                {prof?.business_name && (
                  <p className="text-xs mt-0.5 truncate" style={{ color: 'rgba(0,38,105,0.4)' }}>{prof.business_name}</p>
                )}
              </div>
            </div>

            {/* Stats strip */}
            {((prof?.show_handicap && prof?.handicap_index != null) || prof?.open_to_golf_travel) && (
              <div className="flex rounded-2xl overflow-hidden" style={{ background: 'rgba(0,38,105,0.04)' }}>
                {prof?.show_handicap && prof?.handicap_index != null && (
                  <div className="flex-1 py-3 text-center">
                    <p className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: 'rgba(0,38,105,0.38)' }}>HCP</p>
                    <p className="font-sans font-black text-sm" style={{ color: 'var(--color-green-900)' }}>{prof.handicap_index}</p>
                  </div>
                )}
                {prof?.open_to_golf_travel && (
                  <>
                    {prof?.show_handicap && prof?.handicap_index != null && (
                      <div className="w-px my-2.5" style={{ background: 'rgba(0,38,105,0.08)' }} />
                    )}
                    <div className="flex-1 py-3 text-center">
                      <p className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: 'rgba(0,38,105,0.38)' }}>Golf travel</p>
                      <p className="text-sm" style={{ color: 'var(--color-green-700)' }}>✓ Open</p>
                    </div>
                  </>
                )}
              </div>
            )}

            {prof?.value_offered && (
              <div className="rounded-2xl px-4 py-3.5" style={{ background: 'rgba(0,38,105,0.03)', border: '1px solid rgba(0,38,105,0.06)' }}>
                <p className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: 'rgba(0,38,105,0.38)' }}>What they bring</p>
                <p className="text-sm leading-relaxed" style={{ color: 'rgba(0,38,105,0.7)' }}>{prof.value_offered}</p>
              </div>
            )}

            {(prof?.play_frequency || prof?.preferred_play_times) && (
              <div className="rounded-2xl px-4 py-3.5" style={{ background: 'rgba(0,38,105,0.03)', border: '1px solid rgba(0,38,105,0.06)' }}>
                <p className="text-[10px] uppercase tracking-wider mb-2" style={{ color: 'rgba(0,38,105,0.38)' }}>Play habits</p>
                <div className="space-y-1.5">
                  {prof?.play_frequency && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs" style={{ color: 'rgba(0,38,105,0.4)' }}>Frequency</span>
                      <span className="text-xs font-medium" style={{ color: 'var(--color-green-900)' }}>{prof.play_frequency}</span>
                    </div>
                  )}
                  {prof?.preferred_play_times && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs" style={{ color: 'rgba(0,38,105,0.4)' }}>Prefers</span>
                      <span className="text-xs font-medium" style={{ color: 'var(--color-green-900)' }}>{prof.preferred_play_times}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {focusGroups.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wider mb-2" style={{ color: 'rgba(0,38,105,0.38)' }}>Focus groups</p>
                <div className="flex flex-wrap gap-1.5">
                  {focusGroups.map(g => (
                    <span key={g} className="text-xs font-medium px-2.5 py-1 rounded-full"
                      style={{ background: 'rgba(0,38,105,0.06)', color: 'var(--color-green-900)' }}>
                      {g}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {prof?.non_golf_hobbies && (
              <div className="rounded-2xl px-4 py-3.5" style={{ background: 'rgba(0,38,105,0.03)', border: '1px solid rgba(0,38,105,0.06)' }}>
                <p className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: 'rgba(0,38,105,0.38)' }}>Beyond the course</p>
                <p className="text-sm leading-relaxed" style={{ color: 'rgba(0,38,105,0.7)' }}>{prof.non_golf_hobbies}</p>
              </div>
            )}

            {memberId && (
              <a href={`/members/${memberId}`} className="btn btn-primary btn-full text-center block">
                View profile
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
