'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useProfile } from '@/hooks/useProfile'
import { apiClient } from '@/lib/api-client'
import AppShell from '@/components/layout/AppShell'
import { CardSkeleton } from '@/components/ui/Loading'
import { formatRelativeTime } from '@/lib/utils'
import type { Announcement } from '@/types'

const TYPE_ICONS: Record<string, string> = {
  new_member:       '👋',
  booking:          '⛳',
  visiting_member:  '✈️',
  member_event:     '📅',
  admin_broadcast:  '📢',
  focus_linkup:     '🎯',
}

const TYPE_LABELS: Record<string, string> = {
  new_member:       'New member',
  booking:          'Tee time',
  visiting_member:  'Visiting member',
  member_event:     'Member event',
  admin_broadcast:  'Announcement',
  focus_linkup:     'Focus LinkUp',
}

export default function AnnouncementsPage() {
  const { user } = useProfile()
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (user) loadAnnouncements()
  }, [user])

  async function loadAnnouncements() {
    const response = await apiClient.get<Announcement[]>('/api/announcements')
    setAnnouncements(response.data ?? [])
    setLoading(false)
  }

  return (
    <AppShell
      header={
        <div className="top-bar flex items-center justify-between">
          <div>
            <div className="font-sans font-black text-2xl" style={{ color: 'var(--color-gold)' }}>Announcements</div>
            <div className="logo-subtitle">Community updates</div>
          </div>
        </div>
      }
    >
      <div className="pt-4 pb-8">
        {loading ? (
          <div className="px-5 py-4 space-y-3">
            {[1, 2, 3, 4].map(i => <CardSkeleton key={i} lines={2} />)}
          </div>
        ) : announcements.length === 0 ? (
          <div className="flex flex-col items-center text-center px-8 py-16">
            <div
              className="w-20 h-20 rounded-3xl flex items-center justify-center text-4xl mb-5"
              style={{ background: 'rgba(0,38,105,0.06)', border: '1.5px solid rgba(0,38,105,0.08)' }}
            >
              📢
            </div>
            <p className="font-sans font-black text-xl text-green-900 mb-2">Nothing posted yet</p>
            <p className="text-sm text-green-900/45 leading-relaxed max-w-xs">
              Your club coordinator will post course news, member updates, and community highlights here.
            </p>
            <p className="text-xs text-green-900/25 mt-4">Check back soon — announcements will appear as they&apos;re published.</p>
          </div>
        ) : (
          <div className="px-5 space-y-2.5">
            {announcements.map(a => (
              <Link key={a.id} href={`/more/announcements/${a.id}`} className="card p-4 flex gap-3 items-start active:opacity-75 transition-opacity">
                <span className="text-2xl flex-shrink-0 mt-0.5">
                  {TYPE_ICONS[a.type] ?? '📌'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-[10px] uppercase tracking-wider text-green-900/35">
                      {TYPE_LABELS[a.type] ?? a.type}
                    </span>
                    <span className="text-[10px] text-green-900/25">·</span>
                    <span className="text-[10px] text-green-900/35">
                      {formatRelativeTime(a.published_at ?? a.created_at)}
                    </span>
                  </div>
                  <p className="text-sm font-black text-green-900 leading-snug line-clamp-2">{a.title}</p>
                  <p className="text-xs mt-1 text-green-900/55 leading-relaxed line-clamp-2">{a.body}</p>
                </div>
                <AnnouncementThumbnail announcement={a} />
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  )
}

function AnnouncementThumbnail({ announcement }: { announcement: Announcement }) {
  const url = announcement.media_urls?.[0] ?? announcement.image_url ?? announcement.video_url
  if (!url) return null
  const ext = url.split('?')[0]?.split('.').pop()?.toLowerCase() ?? ''
  const isVideo = ['mp4', 'webm', 'mov', 'quicktime'].includes(ext)
  const count = announcement.media_urls?.length
    ?? ((announcement.image_url ? 1 : 0) + (announcement.video_url ? 1 : 0))
  return (
    <div className="relative w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 bg-black">
      {isVideo ? (
        <video src={url} className="w-full h-full object-cover" muted playsInline />
      ) : (
        <img src={url} alt="" className="w-full h-full object-cover" />
      )}
      {count > 1 && (
        <div className="absolute bottom-1 right-1 flex items-center gap-0.5 text-[9px] font-semibold text-white px-1.5 py-0.5 rounded-full leading-none"
          style={{ background: 'rgba(0,0,0,0.65)' }}>
          <StackIcon />
          {count}
        </div>
      )}
    </div>
  )
}

function StackIcon() {
  return (
    <svg className="w-2.5 h-2.5" viewBox="0 0 16 16" fill="currentColor">
      <rect x="3" y="6" width="10" height="8" rx="1.5" opacity="0.6" />
      <rect x="1" y="4" width="10" height="8" rx="1.5" opacity="0.4" />
      <rect x="5" y="2" width="10" height="8" rx="1.5" />
    </svg>
  )
}

