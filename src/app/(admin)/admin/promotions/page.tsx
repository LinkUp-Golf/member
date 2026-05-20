'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { AdminPageHeader, AdminTable, AdminTr, AdminTd, AdminButton, AdminCard, Badge } from '@/components/admin/AdminUI'
import { formatBookingDate } from '@/lib/utils'
import { Spinner } from '@/components/ui/Loading'

export default function AdminPromotionsPage() {
  const [promotions, setPromotions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [courseId, setCourseId] = useState('')

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const supabase = createClient()
    const { data: course } = await supabase.from('courses').select('id').eq('slug', 'aviara').single()
    if (course) setCourseId(course.id)
    const { data } = await supabase.from('promotions').select('*').order('sort_order').order('created_at', { ascending: false })
    setPromotions(data ?? [])
    setLoading(false)
  }

  async function toggleActive(id: string, active: boolean) {
    const supabase = createClient()
    await supabase.from('promotions').update({ active: !active }).eq('id', id)
    await loadData()
  }

  async function deletePromo(id: string) {
    if (!confirm('Delete this promotion?')) return
    const supabase = createClient()
    await supabase.from('promotions').delete().eq('id', id)
    await loadData()
  }

  return (
    <div className="p-8 max-w-5xl">
      <AdminPageHeader
        title="Promotions"
        description={`${promotions.filter(p => p.active).length} active · ${promotions.filter(p => !p.active).length} inactive`}
        action={<AdminButton label="+ Add promotion" onClick={() => setShowForm(true)} variant="gold" />}
      />

      {showForm && (
        <div className="mb-6">
          <CreatePromotionForm
            courseId={courseId}
            onCreated={() => { setShowForm(false); loadData() }}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      <AdminTable
        headers={['Promotion', 'Partner', 'Scope', 'Expires', 'Status', 'Actions']}
        empty={loading ? 'Loading…' : promotions.length === 0 ? 'No promotions yet.' : undefined}
      >
        {promotions.map(p => (
          <AdminTr key={p.id}>
            <AdminTd>
              <p className="font-medium text-gray-900">{p.title}</p>
              <p className="text-xs text-gray-400 mt-0.5 max-w-sm truncate">{p.description}</p>
            </AdminTd>
            <AdminTd>
              <p className="text-sm">{p.partner_name}</p>
              <p className="text-xs text-gray-400">{p.badge_label}</p>
            </AdminTd>
            <AdminTd>
              <Badge label={p.course_id ? 'Aviara only' : 'All courses'} colour={p.course_id ? 'blue' : 'green'} />
            </AdminTd>
            <AdminTd>
              <span className="text-sm text-gray-600">
                {p.expires_at ? formatBookingDate(p.expires_at) : <span className="text-gray-300">No expiry</span>}
              </span>
            </AdminTd>
            <AdminTd>
              <Badge label={p.active ? 'Active' : 'Inactive'} colour={p.active ? 'green' : 'gray'} />
            </AdminTd>
            <AdminTd>
              <div className="flex gap-1.5">
                <AdminButton
                  label={p.active ? 'Deactivate' : 'Activate'}
                  onClick={() => toggleActive(p.id, p.active)}
                  variant="ghost"
                  size="sm"
                />
                <AdminButton label="Delete" onClick={() => deletePromo(p.id)} variant="danger" size="sm" />
              </div>
            </AdminTd>
          </AdminTr>
        ))}
      </AdminTable>
    </div>
  )
}

function CreatePromotionForm({ courseId, onCreated, onCancel }: { courseId: string; onCreated: () => void; onCancel: () => void }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [partner, setPartner] = useState('')
  const [badge, setBadge] = useState('')
  const [ctaLabel, setCtaLabel] = useState('Learn more')
  const [ctaUrl, setCtaUrl] = useState('')
  const [expires, setExpires] = useState('')
  const [allCourses, setAllCourses] = useState(true)
  const [saving, setSaving] = useState(false)

  async function handleSubmit() {
    if (!title || !description || !partner || !badge) return
    setSaving(true)
    const supabase = createClient()
    await supabase.from('promotions').insert({
      course_id: allCourses ? null : courseId,
      title, description,
      partner_name: partner,
      badge_label: badge,
      cta_label: ctaLabel,
      cta_url: ctaUrl.trim() || null,
      expires_at: expires || null,
      active: true,
      sort_order: 0,
    })
    setSaving(false)
    onCreated()
  }

  return (
    <AdminCard title="Add promotion">
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="col-span-2">
          <label className="text-xs text-gray-400 mb-1 block">Title</label>
          <input className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-green-500"
            placeholder="Complimentary Club Fitting" value={title} onChange={e => setTitle(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Partner name</label>
          <input className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-green-500"
            placeholder="Aviara Pro Shop" value={partner} onChange={e => setPartner(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Badge label</label>
          <input className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-green-500"
            placeholder="Pro Shop · Aviara" value={badge} onChange={e => setBadge(e.target.value)} />
        </div>
        <div className="col-span-2">
          <label className="text-xs text-gray-400 mb-1 block">Description</label>
          <textarea rows={3} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-green-500 resize-none"
            value={description} onChange={e => setDescription(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">CTA button label</label>
          <input className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-green-500"
            value={ctaLabel} onChange={e => setCtaLabel(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">CTA URL (optional)</label>
          <input type="url" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-green-500"
            placeholder="https://…" value={ctaUrl} onChange={e => setCtaUrl(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Expiry date (optional)</label>
          <input type="date" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-green-500"
            value={expires} onChange={e => setExpires(e.target.value)} />
        </div>
        <div className="flex items-center gap-3 mt-4">
          <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-600">
            <input type="checkbox" checked={allCourses} onChange={e => setAllCourses(e.target.checked)} className="rounded" />
            Show on all courses
          </label>
        </div>
      </div>
      <div className="flex gap-3 justify-end">
        <AdminButton label="Cancel" onClick={onCancel} variant="ghost" />
        <AdminButton
          label={saving ? 'Saving…' : 'Create promotion'}
          onClick={handleSubmit}
          variant="gold"
          disabled={!title || !description || !partner || !badge || saving}
        />
      </div>
    </AdminCard>
  )
}
