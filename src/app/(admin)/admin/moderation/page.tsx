'use client'

import { useState, useEffect } from 'react'
import { useAuthStore } from '@/store/auth'
import { createClient } from '@/lib/supabase'
import {
  AdminPageHeader, AdminCard, AdminButton, Badge,
} from '@/components/admin/AdminUI'
import { formatRelativeTime, formatBookingDate } from '@/lib/utils'

interface ModerationItem {
  id: string
  type: 'event' | 'announcement'
  title: string
  body: string
  author: string
  submittedAt: string
  status: string
  extra?: Record<string, string>
}

export default function AdminModerationPage() {
  const { user } = useAuthStore()
  const [items, setItems] = useState<ModerationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState<string | null>(null)

  useEffect(() => { loadQueue() }, [])

  async function loadQueue() {
    const supabase = createClient()

    const [eventsRes, announcementsRes] = await Promise.all([
      supabase
        .from('member_events')
        .select('id, title, description, event_date, event_time, location, status, created_at, organizer:members(first_name, last_name)')
        .eq('status', 'pending_review')
        .order('created_at', { ascending: true }),
      supabase
        .from('announcements')
        .select('id, title, body, type, status, created_at, author:members(first_name, last_name)')
        .eq('status', 'pending_review')
        .order('created_at', { ascending: true }),
    ])

    const eventItems: ModerationItem[] = (eventsRes.data ?? []).map((e: any) => ({
      id: e.id,
      type: 'event' as const,
      title: e.title,
      body: e.description,
      author: e.organizer ? `${e.organizer.first_name} ${e.organizer.last_name}` : 'Unknown',
      submittedAt: e.created_at,
      status: e.status,
      extra: {
        Date: formatBookingDate(e.event_date),
        Time: e.event_time?.slice(0, 5) ?? '',
        Location: e.location,
      },
    }))

    const announcementItems: ModerationItem[] = (announcementsRes.data ?? []).map((a: any) => ({
      id: a.id,
      type: 'announcement' as const,
      title: a.title,
      body: a.body,
      author: a.author ? `${a.author.first_name} ${a.author.last_name}` : 'Unknown',
      submittedAt: a.created_at,
      status: a.status,
    }))

    setItems([...eventItems, ...announcementItems].sort(
      (a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime()
    ))
    setLoading(false)
  }

  async function decide(item: ModerationItem, decision: 'published' | 'rejected') {
    setProcessing(item.id)
    const supabase = createClient()
    const table = item.type === 'event' ? 'member_events' : 'announcements'

    const update: Record<string, unknown> = {
      status: decision,
      reviewed_by: user?.id,
    }

    if (decision === 'published' && item.type === 'announcement') {
      update.published_at = new Date().toISOString()
    }

    await supabase.from(table).update(update).eq('id', item.id)

    // If approving a member event, create an announcement for it
    if (decision === 'published' && item.type === 'event') {
      const { data: event } = await supabase
        .from('member_events')
        .select('*, organizer:members(id, home_course_id)')
        .eq('id', item.id)
        .single()

      if (event) {
        await supabase.from('announcements').insert({
          course_id: (event.organizer as any)?.home_course_id,
          author_id: (event.organizer as any)?.id,
          type: 'member_event',
          title: `New event: ${event.title}`,
          body: `${item.author} has posted a community event on ${formatBookingDate(event.event_date)}. Check the Member Events calendar to RSVP.`,
          metadata: { event_id: event.id },
          status: 'published',
          published_at: new Date().toISOString(),
        })
      }
    }

    await loadQueue()
    setProcessing(null)
  }

  return (
    <div className="p-8 max-w-4xl">
      <AdminPageHeader
        title="Moderation Queue"
        subtitle={loading ? '' : `${items.length} item${items.length !== 1 ? 's' : ''} awaiting review`}
      />

      {loading ? (
        <div className="space-y-4">
          {[1,2,3].map(i => <div key={i} className="h-40 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-5xl mb-4">✅</p>
          <p className="text-xl font-semibold text-gray-700 mb-2">Queue is clear</p>
          <p className="text-gray-400">No items awaiting moderation.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {items.map(item => (
            <AdminCard key={item.id}>
              <div className="flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  {/* Header */}
                  <div className="flex items-center gap-2 mb-2">
                    <Badge
                      label={item.type === 'event' ? '📅 Member event' : '📢 Announcement'}
                      colour={item.type === 'event' ? 'blue' : 'gold'}
                    />
                    <span className="text-xs text-gray-400">
                      by {item.author} · {formatRelativeTime(item.submittedAt)}
                    </span>
                  </div>

                  {/* Content */}
                  <h3 className="font-semibold text-gray-900 mb-1.5">{item.title}</h3>
                  <p className="text-sm text-gray-600 leading-relaxed mb-3">{item.body}</p>

                  {/* Extra details for events */}
                  {item.extra && (
                    <div className="flex gap-4 text-xs text-gray-400">
                      {Object.entries(item.extra).map(([k, v]) => (
                        v && <span key={k}><span className="font-medium text-gray-500">{k}:</span> {v}</span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-2 flex-shrink-0 pt-1">
                  <AdminButton
                    label="✓ Approve"
                    onClick={() => decide(item, 'published')}
                    variant="gold"
                    disabled={processing === item.id}
                  />
                  <AdminButton
                    label="✕ Reject"
                    onClick={() => decide(item, 'rejected')}
                    variant="danger"
                    disabled={processing === item.id}
                  />
                </div>
              </div>
            </AdminCard>
          ))}
        </div>
      )}
    </div>
  )
}
