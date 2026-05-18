'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/auth'
import { createClient } from '@/lib/supabase'
import TopBar from '@/components/ui/TopBar'
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
  const { user } = useAuthStore()
  const router = useRouter()
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (user) loadAnnouncements()
  }, [user])

  async function loadAnnouncements() {
    const supabase = createClient()
    const courseId = user?.member?.home_course_id
    const { data } = await supabase
      .from('announcements')
      .select('*')
      .eq('course_id', courseId)
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(50)
    setAnnouncements((data ?? []) as Announcement[])
    setLoading(false)
  }

  return (
    <div>
      <div className="top-bar flex items-center gap-3">
        <button onClick={() => router.push('/more')} className="text-gold text-sm flex items-center gap-1">
          <BackArrow /> More
        </button>
        <div className="flex-1">
          <div className="logo-text">Announcements</div>
          <div className="logo-subtitle">Community updates</div>
        </div>
      </div>

      <div className="pb-8">
        {loading ? (
          <div className="px-5 py-4 space-y-3">
            {[1, 2, 3, 4].map(i => <CardSkeleton key={i} lines={2} />)}
          </div>
        ) : announcements.length === 0 ? (
          <div className="text-center py-16 px-8">
            <p className="text-3xl mb-3">📢</p>
            <p className="font-serif text-xl text-green-900 mb-2">No announcements yet</p>
            <p className="text-sm text-green-900/45">Community announcements will appear here.</p>
          </div>
        ) : (
          <div className="divide-y divide-green-900/06">
            {announcements.map(a => (
              <div key={a.id} className="px-5 py-4 flex gap-3 items-start">
                <span className="text-2xl flex-shrink-0 mt-0.5">
                  {TYPE_ICONS[a.type] ?? '📌'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs uppercase tracking-wider text-green-900/35">
                      {TYPE_LABELS[a.type] ?? a.type}
                    </span>
                    <span className="text-xs text-green-900/25">·</span>
                    <span className="text-xs text-green-900/35">
                      {a.published_at ? formatRelativeTime(a.published_at) : ''}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-green-900 mb-1">{a.title}</p>
                  <p className="text-sm text-green-900/60 leading-relaxed">{a.body}</p>
                </div>
              </div>
            ))}
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
