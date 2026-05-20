'use client'

import { useState, useEffect } from 'react'
import { useAuthStore } from '@/store/auth'
import { createClient } from '@/lib/supabase'
import { AdminPageHeader, AdminTable, AdminTr, AdminTd, AdminButton, AdminCard, Badge } from '@/components/admin/AdminUI'
import { formatRelativeTime } from '@/lib/utils'

const TYPE_OPTIONS = [
  { value: 'admin_broadcast', label: 'Admin broadcast' },
  { value: 'focus_linkup',   label: 'Focus LinkUp reminder' },
  { value: 'new_member',     label: 'New member welcome' },
]

export default function AdminAnnouncementsPage() {
  const { user } = useAuthStore()
  const [announcements, setAnnouncements] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [courseId, setCourseId] = useState('')

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const supabase = createClient()
    const { data: course } = await supabase.from('courses').select('id').eq('slug', 'aviara').single()
    if (course) setCourseId(course.id)

    const { data } = await supabase
      .from('announcements')
      .select('*, author:members(first_name, last_name)')
      .eq('course_id', course?.id)
      .order('created_at', { ascending: false })
      .limit(50)
    setAnnouncements(data ?? [])
    setLoading(false)
  }

  async function createBroadcast(title: string, body: string, type: string) {
    const supabase = createClient()
    await supabase.from('announcements').insert({
      course_id: courseId,
      author_id: user?.id,
      type,
      title,
      body,
      status: 'published',
      published_at: new Date().toISOString(),
    })
    await loadData()
    setShowForm(false)
  }

  async function deleteAnnouncement(id: string) {
    if (!confirm('Delete this announcement?')) return
    const supabase = createClient()
    await supabase.from('announcements').delete().eq('id', id)
    await loadData()
  }

  const TYPE_ICONS: Record<string, string> = {
    new_member: '👋', booking: '⛳', visiting_member: '✈️',
    member_event: '📅', admin_broadcast: '📢', focus_linkup: '🎯',
  }

  return (
    <div className="p-8 max-w-5xl">
      <AdminPageHeader
        title="Announcements"
        description="Broadcast messages to the community"
        action={<AdminButton label="+ New broadcast" onClick={() => setShowForm(true)} variant="gold" />}
      />

      {showForm && (
        <div className="mb-6">
          <BroadcastForm
            onSubmit={createBroadcast}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      <AdminTable
        headers={['Type', 'Title', 'Author', 'Status', 'Date', 'Actions']}
        empty={loading ? 'Loading…' : announcements.length === 0 ? 'No announcements yet.' : undefined}
      >
        {announcements.map(a => (
          <AdminTr key={a.id}>
            <AdminTd>
              <span className="text-lg">{TYPE_ICONS[a.type] ?? '📌'}</span>
            </AdminTd>
            <AdminTd>
              <p className="font-medium text-gray-900 max-w-xs">{a.title}</p>
              <p className="text-xs text-gray-400 mt-0.5 max-w-xs truncate">{a.body}</p>
            </AdminTd>
            <AdminTd>
              <span className="text-sm text-gray-600">
                {a.author?.first_name} {a.author?.last_name}
              </span>
            </AdminTd>
            <AdminTd>
              <Badge
                label={a.status === 'published' ? 'Published' : a.status === 'pending_review' ? 'Pending' : 'Rejected'}
                colour={a.status === 'published' ? 'green' : a.status === 'pending_review' ? 'yellow' : 'red'}
              />
            </AdminTd>
            <AdminTd>
              <span className="text-xs text-gray-400">
                {formatRelativeTime(a.published_at ?? a.created_at)}
              </span>
            </AdminTd>
            <AdminTd>
              <AdminButton label="Delete" onClick={() => deleteAnnouncement(a.id)} variant="danger" size="sm" />
            </AdminTd>
          </AdminTr>
        ))}
      </AdminTable>
    </div>
  )
}

function BroadcastForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (title: string, body: string, type: string) => Promise<void>
  onCancel: () => void
}) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [type, setType] = useState('admin_broadcast')
  const [saving, setSaving] = useState(false)

  async function handleSubmit() {
    if (!title.trim() || !body.trim()) return
    setSaving(true)
    await onSubmit(title, body, type)
    setSaving(false)
  }

  return (
    <AdminCard title="New community broadcast">
      <div className="space-y-4">
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Announcement type</label>
          <select
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-green-500"
            value={type}
            onChange={e => setType(e.target.value)}
          >
            {TYPE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Title</label>
          <input
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-green-500"
            placeholder="Announcement headline…"
            value={title}
            onChange={e => setTitle(e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Body</label>
          <textarea
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-green-500 resize-none"
            rows={4}
            placeholder="Write your message to the community…"
            value={body}
            onChange={e => setBody(e.target.value)}
          />
        </div>
        <p className="text-xs text-gray-400">
          This will be published immediately and visible to all Aviara members.
        </p>
        <div className="flex gap-3 justify-end">
          <AdminButton label="Cancel" onClick={onCancel} variant="ghost" />
          <AdminButton
            label={saving ? 'Publishing…' : 'Publish broadcast'}
            onClick={handleSubmit}
            variant="gold"
            disabled={!title.trim() || !body.trim() || saving}
          />
        </div>
      </div>
    </AdminCard>
  )
}
