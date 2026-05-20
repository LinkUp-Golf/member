'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { AdminPageHeader, AdminTable, AdminTr, AdminTd, AdminButton, AdminCard } from '@/components/admin/AdminUI'
import { INDUSTRY_CATEGORIES } from '@/types'
import { format } from 'date-fns'
import { Spinner } from '@/components/ui/Loading'

export default function AdminFocusLinkupsPage() {
  const [linkups, setLinkups] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [courseId, setCourseId] = useState('')

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const supabase = createClient()
    const { data: course } = await supabase.from('courses').select('id').eq('slug', 'aviara').single()
    if (course) setCourseId(course.id)

    const { data } = await supabase
      .from('focus_linkups')
      .select('*')
      .order('focus_date', { ascending: true })
    setLinkups(data ?? [])
    setLoading(false)
  }

  async function deleteLinkup(id: string) {
    if (!confirm('Delete this Focus LinkUp?')) return
    const supabase = createClient()
    await supabase.from('focus_linkups').delete().eq('id', id)
    await loadData()
  }

  async function sendNotification(id: string, type: '2w' | '1w') {
    // In production, trigger GHL workflow for subscribed members
    const supabase = createClient()
    const field = type === '2w' ? 'notification_sent_2w' : 'notification_sent_1w'
    await supabase.from('focus_linkups').update({ [field]: true }).eq('id', id)
    await loadData()
    alert(`${type === '2w' ? '2-week' : '1-week'} notification sent to subscribed members.`)
  }

  const todayISO = new Date().toISOString().slice(0, 10)
  const upcoming = linkups.filter(l => l.focus_date >= todayISO)
  const past = linkups.filter(l => l.focus_date < todayISO)

  return (
    <div className="p-4 sm:p-8 max-w-5xl">
      <AdminPageHeader
        title="Focus LinkUps"
        description={`${upcoming.length} upcoming · ${past.length} past`}
        action={<AdminButton label="+ Create Focus LinkUp" onClick={() => setShowForm(true)} variant="gold" />}
      />

      {showForm && (
        <div className="mb-6">
          <CreateFocusLinkupForm
            courseId={courseId}
            onCreated={() => { setShowForm(false); loadData() }}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      {/* Upcoming */}
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Upcoming</h2>
      <AdminTable
        headers={['Title', 'Date', 'Industry focus', '2wk notif', '1wk notif', 'Actions']}
        empty={loading ? 'Loading…' : upcoming.length === 0 ? 'No upcoming Focus LinkUps. Create one above.' : undefined}
      >
        {upcoming.map(l => (
          <AdminTr key={l.id}>
            <AdminTd><p className="font-medium text-gray-900">{l.title}</p></AdminTd>
            <AdminTd>
              <p className="text-sm">{format(new Date(l.focus_date + 'T12:00:00'), 'EEE, MMM d')}</p>
              <p className="text-xs text-gray-400">{l.tee_time?.slice(0, 5)}</p>
            </AdminTd>
            <AdminTd>
              <div className="flex flex-wrap gap-1 max-w-xs">
                {(l.industry_focus ?? []).map((f: string) => (
                  <span key={f} className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full">{f}</span>
                ))}
              </div>
            </AdminTd>
            <AdminTd>
              {l.notification_sent_2w ? (
                <span className="text-xs text-green-600">Sent ✓</span>
              ) : (
                <AdminButton label="Send" onClick={() => sendNotification(l.id, '2w')} variant="ghost" size="sm" />
              )}
            </AdminTd>
            <AdminTd>
              {l.notification_sent_1w ? (
                <span className="text-xs text-green-600">Sent ✓</span>
              ) : (
                <AdminButton label="Send" onClick={() => sendNotification(l.id, '1w')} variant="ghost" size="sm" />
              )}
            </AdminTd>
            <AdminTd>
              <AdminButton label="Delete" onClick={() => deleteLinkup(l.id)} variant="danger" size="sm" />
            </AdminTd>
          </AdminTr>
        ))}
      </AdminTable>

      {past.length > 0 && (
        <>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 mt-8">Past</h2>
          <AdminTable headers={['Title', 'Date', 'Industry focus']} empty="">
            {past.slice(0, 10).map(l => (
              <AdminTr key={l.id}>
                <AdminTd><p className="text-gray-500">{l.title}</p></AdminTd>
                <AdminTd><span className="text-xs text-gray-400">{format(new Date(l.focus_date + 'T12:00:00'), 'MMM d, yyyy')}</span></AdminTd>
                <AdminTd>
                  <div className="flex flex-wrap gap-1">
                    {(l.industry_focus ?? []).map((f: string) => (
                      <span key={f} className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{f}</span>
                    ))}
                  </div>
                </AdminTd>
              </AdminTr>
            ))}
          </AdminTable>
        </>
      )}
    </div>
  )
}

function CreateFocusLinkupForm({ courseId, onCreated, onCancel }: { courseId: string; onCreated: () => void; onCancel: () => void }) {
  const today = new Date().toISOString().split('T')[0]
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('07:30')
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  function toggleCategory(cat: string) {
    setSelectedCategories(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat])
  }

  async function handleSubmit() {
    if (!title || !date || selectedCategories.length === 0) return
    setSaving(true)
    const supabase = createClient()
    await supabase.from('focus_linkups').insert({
      course_id: courseId,
      title,
      description,
      focus_date: date,
      tee_time: time + ':00',
      industry_focus: selectedCategories,
    })
    setSaving(false)
    onCreated()
  }

  return (
    <AdminCard title="Create Focus LinkUp">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div className="col-span-1 sm:col-span-2">
          <label className="text-xs text-gray-400 mb-1 block">Title</label>
          <input className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-green-500"
            placeholder="Life Sciences LinkUp" value={title} onChange={e => setTitle(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Date</label>
          <input type="date" min={today} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-green-500"
            value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Tee time</label>
          <input type="time" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-green-500"
            value={time} onChange={e => setTime(e.target.value)} />
        </div>
        <div className="col-span-1 sm:col-span-2">
          <label className="text-xs text-gray-400 mb-1 block">Description</label>
          <textarea rows={2} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-green-500 resize-none"
            placeholder="Brief description for notifications…" value={description} onChange={e => setDescription(e.target.value)} />
        </div>
        <div className="col-span-1 sm:col-span-2">
          <label className="text-xs text-gray-400 mb-2 block">Industry focus (select all that apply)</label>
          <div className="flex flex-wrap gap-2">
            {INDUSTRY_CATEGORIES.map(cat => (
              <button
                key={cat}
                onClick={() => toggleCategory(cat)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  selectedCategories.includes(cat)
                    ? 'bg-green-900 text-white border-green-900'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="flex gap-3 justify-end">
        <AdminButton label="Cancel" onClick={onCancel} variant="ghost" />
        <AdminButton
          label={saving ? 'Creating…' : 'Create Focus LinkUp'}
          onClick={handleSubmit}
          variant="gold"
          disabled={!title || !date || selectedCategories.length === 0 || saving}
        />
      </div>
    </AdminCard>
  )
}
