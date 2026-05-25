'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuthStore } from '@/store/auth'
import { createClient } from '@/lib/supabase'
import {
  AdminPageHeader, AdminCard, AdminButton, Badge,
} from '@/components/admin/AdminUI'
import { formatRelativeTime, formatBookingDate, capitalizeName } from '@/lib/utils'

interface RawMember {
  id: string
  first_name: string
  last_name: string
  membership_status: string
  warning_count: number
  home_course_id?: string
}

interface RawEventRow {
  id: string
  title: string
  description: string
  event_date: string
  event_time: string | null
  location: string
  status: string
  created_at: string
  organizer_id: string
  organizer: RawMember | null
}

interface RawAnnouncementRow {
  id: string
  title: string
  body: string
  type: string
  status: string
  created_at: string
  author_id: string
  author: RawMember | null
}

interface ModerationItem {
  id: string
  type: 'event' | 'announcement'
  title: string
  body: string
  author: string
  authorId: string
  authorStatus: string
  warningCount: number
  submittedAt: string
  status: string
  extra?: Record<string, string>
}

const STATUS_COLOURS: Record<string, string> = {
  active:    'bg-green-50 text-green-700',
  suspended: 'bg-red-50 text-red-600',
  waitlist:  'bg-yellow-50 text-yellow-700',
  pending:   'bg-gray-100 text-gray-500',
  cancelled: 'bg-gray-100 text-gray-400',
}

export default function AdminModerationPage() {
  const { user } = useAuthStore()
  const [items, setItems] = useState<ModerationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  const loadQueue = useCallback(async () => {
    const supabase = createClient()

    const [eventsRes, announcementsRes] = await Promise.all([
      supabase
        .from('member_events')
        .select(`
          id, title, description, event_date, event_time, location,
          status, created_at, organizer_id,
          organizer:members!organizer_id(id, first_name, last_name, membership_status, warning_count)
        `)
        .eq('status', 'pending_review')
        .order('created_at', { ascending: true }),
      supabase
        .from('announcements')
        .select(`
          id, title, body, type, status, created_at, author_id,
          author:members!author_id(id, first_name, last_name, membership_status, warning_count)
        `)
        .eq('status', 'pending_review')
        .order('created_at', { ascending: true }),
    ])

    const eventItems: ModerationItem[] = ((eventsRes.data ?? []) as unknown as RawEventRow[]).map((e) => ({
      id: e.id,
      type: 'event' as const,
      title: e.title,
      body: e.description,
      author: e.organizer ? `${capitalizeName(e.organizer.first_name)} ${capitalizeName(e.organizer.last_name)}` : 'Unknown',
      authorId: e.organizer?.id ?? e.organizer_id,
      authorStatus: e.organizer?.membership_status ?? 'active',
      warningCount: e.organizer?.warning_count ?? 0,
      submittedAt: e.created_at,
      status: e.status,
      extra: {
        Date: formatBookingDate(e.event_date),
        Time: e.event_time?.slice(0, 5) ?? '',
        Location: e.location,
      },
    }))

    const announcementItems: ModerationItem[] = ((announcementsRes.data ?? []) as unknown as RawAnnouncementRow[]).map((a) => ({
      id: a.id,
      type: 'announcement' as const,
      title: a.title,
      body: a.body,
      author: a.author ? `${capitalizeName(a.author.first_name)} ${capitalizeName(a.author.last_name)}` : 'Unknown',
      authorId: a.author?.id ?? a.author_id,
      authorStatus: a.author?.membership_status ?? 'active',
      warningCount: a.author?.warning_count ?? 0,
      submittedAt: a.created_at,
      status: a.status,
    }))

    setItems([...eventItems, ...announcementItems].sort(
      (a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime()
    ))
    setLoading(false)
  }, [])

  useEffect(() => { loadQueue() }, [loadQueue])

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

    if (decision === 'published' && item.type === 'event') {
      const { data: event } = await supabase
        .from('member_events')
        .select('*, organizer:members(id, home_course_id)')
        .eq('id', item.id)
        .single()

      if (event) {
        await supabase.from('announcements').insert({
          course_id: (event.organizer as { id: string; home_course_id: string } | null)?.home_course_id,
          author_id: (event.organizer as { id: string; home_course_id: string } | null)?.id,
          type: 'member_event',
          title: `New event: ${event.title}`,
          body: `${item.author} has posted a community event on ${formatBookingDate(event.event_date)}. Check the Member Events calendar to RSVP.`,
          metadata: { event_id: event.id },
          status: 'published',
          published_at: new Date().toISOString(),
        })
      }
    }

    showToast(decision === 'published' ? 'Approved and published.' : 'Rejected.')
    await loadQueue()
    setProcessing(null)
  }

  async function memberAction(item: ModerationItem, action: 'warn' | 'suspend' | 'unsuspend') {
    if (!item.authorId) return
    setProcessing(`${item.id}-${action}`)

    const res = await fetch('/api/admin/moderation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        member_id: item.authorId,
        item_id: item.id,
        item_type: item.type,
      }),
    })

    if (res.ok) {
      const msgs: Record<string, string> = {
        warn:      `Warning issued to ${item.author}.`,
        suspend:   `${item.author} has been suspended.`,
        unsuspend: `${item.author} has been reinstated.`,
      }
      showToast(msgs[action] ?? 'Done.')
      await loadQueue()
    } else {
      showToast('Action failed. Please try again.', false)
    }

    setProcessing(null)
  }

  const isProcessing = (key: string) => processing === key || processing === `${key}-warn` || processing === `${key}-suspend` || processing === `${key}-unsuspend`

  return (
    <div className="p-4 sm:p-8 max-w-4xl">
      <AdminPageHeader
        title="Moderation Queue"
        description={loading ? '' : `${items.length} item${items.length !== 1 ? 's' : ''} awaiting review`}
      />

      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium transition-all ${
          toast.ok ? 'bg-green-900 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.msg}
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          {[1,2,3].map(i => <div key={i} className="h-48 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-5xl mb-4">✅</p>
          <p className="text-xl font-semibold text-gray-700 mb-2">Queue is clear</p>
          <p className="text-gray-400">No items awaiting moderation.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {items.map(item => {
            const suspended = item.authorStatus === 'suspended'
            return (
              <AdminCard key={item.id}>
                <div className="flex flex-col gap-4">
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center flex-wrap gap-2">
                      <Badge
                        label={item.type === 'event' ? '📅 Member event' : '📢 Announcement'}
                        colour={item.type === 'event' ? 'blue' : 'gold'}
                      />
                      <span className="text-xs text-gray-500 font-medium">{item.author}</span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${STATUS_COLOURS[item.authorStatus] ?? 'bg-gray-100 text-gray-500'}`}>
                        {item.authorStatus}
                      </span>
                      {item.warningCount > 0 && (
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-orange-50 text-orange-600">
                          ⚠ {item.warningCount} warning{item.warningCount !== 1 ? 's' : ''}
                        </span>
                      )}
                      <span className="text-xs text-gray-400">{formatRelativeTime(item.submittedAt)}</span>
                    </div>
                  </div>

                  {/* Content */}
                  <div>
                    <h3 className="font-semibold text-gray-900 mb-1.5">{item.title}</h3>
                    <p className="text-sm text-gray-600 leading-relaxed mb-3">{item.body}</p>
                    {item.extra && (
                      <div className="flex gap-4 text-xs text-gray-400">
                        {Object.entries(item.extra).map(([k, v]) =>
                          v ? <span key={k}><span className="font-medium text-gray-500">{k}:</span> {v}</span> : null
                        )}
                      </div>
                    )}
                  </div>

                  {/* Action row */}
                  <div className="flex items-center gap-2 pt-1 border-t border-gray-50 flex-wrap">
                    {/* Content actions */}
                    <div className="flex gap-2 flex-1">
                      <AdminButton
                        label="✓ Approve"
                        onClick={() => decide(item, 'published')}
                        variant="gold"
                        disabled={isProcessing(item.id)}
                      />
                      <AdminButton
                        label="✕ Reject"
                        onClick={() => decide(item, 'rejected')}
                        variant="danger"
                        disabled={isProcessing(item.id)}
                      />
                    </div>

                    {/* Author actions (separated) */}
                    <div className="flex gap-2 border-l border-gray-100 pl-3">
                      <span className="text-xs text-gray-400 self-center">Author:</span>
                      <AdminButton
                        label="⚠ Warn"
                        onClick={() => memberAction(item, 'warn')}
                        variant="ghost"
                        size="sm"
                        disabled={isProcessing(item.id)}
                      />
                      {suspended ? (
                        <AdminButton
                          label="↩ Reinstate"
                          onClick={() => memberAction(item, 'unsuspend')}
                          variant="ghost"
                          size="sm"
                          disabled={isProcessing(item.id)}
                        />
                      ) : (
                        <AdminButton
                          label="🚫 Suspend"
                          onClick={() => memberAction(item, 'suspend')}
                          variant="danger"
                          size="sm"
                          disabled={isProcessing(item.id)}
                        />
                      )}
                    </div>
                  </div>
                </div>
              </AdminCard>
            )
          })}
        </div>
      )}
    </div>
  )
}
