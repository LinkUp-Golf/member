'use client'

import { useState, useEffect } from 'react'
import { useProfile } from '@/hooks/useProfile'
import { apiClient } from '@/lib/api-client'
import { capitalizeName } from '@/lib/utils'
import Avatar from '@/components/ui/Avatar'
import { Spinner } from '@/components/ui/Loading'
import AppShell from '@/components/layout/AppShell'
import { INDUSTRY_CATEGORIES } from '@/types'
import type { MemberProfile } from '@/types'

export default function MyProfilePage() {
  const { user, profile, refetch } = useProfile()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<Partial<MemberProfile>>({})
  const [focusGroups, setFocusGroups] = useState<string[]>([])

  useEffect(() => {
    if (profile?.profile) {
      setForm(profile.profile)
    }
  }, [profile])

  useEffect(() => {
    apiClient.get<{ subscriptions: { industry_focus: string; custom_label: string | null; status: string }[] }>('/api/focus-linkups').then(res => {
      if (res.data?.subscriptions) {
        setFocusGroups(
          res.data.subscriptions
            .filter(s => s.status === 'approved')
            .map(s => s.industry_focus === 'Other' && s.custom_label ? s.custom_label : s.industry_focus)
        )
      }
    })
  }, [])

  function set(field: keyof MemberProfile, value: unknown) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function save() {
    if (!user) return
    setSaving(true)

    const response = await apiClient.patch('/api/profile', {
      display_name: form.display_name,
      business_name: form.business_name,
      business_description: form.business_description,
      role_title: form.role_title,
      industry_category: form.industry_category,
      value_offered: form.value_offered,
      value_sought: form.value_sought,
      non_golf_hobbies: form.non_golf_hobbies,
      linkedin_url: form.linkedin_url ?? null,
      profile_visible: form.profile_visible ?? true,
    })

    if (!response.error) {
      await refetch()
      setEditing(false)
    }
    setSaving(false)
  }

  if (!user || !profile) return null
  const m = profile

  return (
    <AppShell title="Profile" description="Your member details">
      {/* Header */}
      <div className="bg-green-900 px-5 pt-5 pb-6 text-center">
        <div className="flex justify-center mb-3">
          <Avatar
            firstName={m.first_name}
            lastName={m.last_name}
            avatarUrl={m.profile?.avatar_url}
            size="xl"
          />
        </div>
        <h1 className="font-sans font-black text-2xl text-white">
          {capitalizeName(m.first_name)} {capitalizeName(m.last_name)}
        </h1>
        {m.profile?.role_title && (
          <p className="text-sm text-white/50 mt-1">
            {m.profile.role_title}{m.profile.business_name ? ` · ${m.profile.business_name}` : ''}
          </p>
        )}
        <div className="flex gap-2 justify-center flex-wrap mt-3">
          {m.home_course?.city && (
            <span className="profile-tag">{m.home_course.city}</span>
          )}
          {m.membership_start_date && (
            <span className="profile-tag">
              Member since {new Date(m.membership_start_date).getFullYear()}
            </span>
          )}
        </div>
      </div>

      {/* Edit / Save toggle */}
      <div className="px-5 py-4">
        {editing ? (
          <div className="flex gap-3">
            <button
              onClick={() => { setEditing(false); setForm(m.profile ?? {}) }}
              className="btn btn-outline flex-1 justify-center"
              disabled={saving}
            >
              Cancel
            </button>
            <button
              onClick={save}
              className="btn btn-gold flex-1 justify-center"
              disabled={saving}
            >
              {saving ? <Spinner className="w-4 h-4" /> : 'Save changes'}
            </button>
          </div>
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="btn btn-primary btn-full"
          >
            Edit my profile
          </button>
        )}
      </div>

      {/* Profile fields */}
      <div className="pb-8">
        <Field
          label="Intro message"
          value={form.business_description}
          editing={editing}
          multiline
          placeholder="Share a brief intro — who you are, what you do, and what makes you distinctive…"
          onChange={v => set('business_description', v)}
        />

        <Field
          label="Title"
          value={form.role_title}
          editing={editing}
          placeholder="e.g. CEO"
          onChange={v => set('role_title', v)}
        />

        <Field
          label="Organization"
          value={form.business_name}
          editing={editing}
          placeholder="e.g. McKenna Infrastructure Group"
          onChange={v => set('business_name', v)}
        />

        <Field
          label="LinkedIn profile"
          value={form.linkedin_url}
          editing={editing}
          placeholder="https://linkedin.com/in/yourprofile"
          onChange={v => set('linkedin_url', v)}
        />

        {editing && (
          <div className="px-5 py-4 border-b border-green-900/08">
            <p className="text-xs uppercase tracking-widest text-green-900/40 mb-2">Industry category</p>
            <select
              className="input"
              value={form.industry_category ?? ''}
              onChange={e => set('industry_category', e.target.value)}
            >
              <option value="">Select a category…</option>
              {INDUSTRY_CATEGORIES.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        )}

        <Field
          label="Value I offer"
          value={form.value_offered}
          editing={editing}
          multiline
          placeholder="What value, connections, or expertise do you bring to the community?"
          onChange={v => set('value_offered', v)}
        />

        <Field
          label="What I'm looking for"
          value={form.value_sought}
          editing={editing}
          multiline
          placeholder="What types of connections, expertise, or opportunities are you seeking?"
          onChange={v => set('value_sought', v)}
        />

        <Field
          label="Hobbies"
          value={form.non_golf_hobbies}
          editing={editing}
          multiline
          placeholder="Your hobbies, interests, and life outside of work…"
          onChange={v => set('non_golf_hobbies', v)}
        />

        {/* Focus LinkUps groups */}
        <div className="px-5 py-4 border-b border-green-900/08">
          <p className="text-xs uppercase tracking-widest text-green-900/40 mb-3">Focus LinkUps groups</p>
          {focusGroups.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {focusGroups.map(g => (
                <span key={g} className="text-xs bg-green-50 text-green-900 px-2.5 py-1 rounded-full border border-green-900/10">
                  {g}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-green-900/30 italic">Not subscribed to any groups — manage in Focus LinkUps</p>
          )}
        </div>

        {/* Privacy */}
        {editing && (
          <div className="px-5 py-4">
            <Toggle
              label="Profile visible to community members"
              checked={form.profile_visible ?? true}
              onChange={v => set('profile_visible', v)}
            />
          </div>
        )}
      </div>
    </AppShell>
  )
}

// ---- Sub-components -----------------------------------------

function Field({
  label, value, editing, multiline, placeholder, onChange,
}: {
  label: string
  value?: string | null
  editing: boolean
  multiline?: boolean
  placeholder?: string
  onChange: (v: string) => void
}) {
  return (
    <div className="px-5 py-4 border-b border-green-900/08">
      <p className="text-xs uppercase tracking-widest text-green-900/40 mb-2">{label}</p>
      {editing ? (
        multiline ? (
          <textarea
            className="input resize-none"
            rows={3}
            placeholder={placeholder}
            value={value ?? ''}
            onChange={e => onChange(e.target.value)}
          />
        ) : (
          <input
            className="input"
            placeholder={placeholder}
            value={value ?? ''}
            onChange={e => onChange(e.target.value)}
          />
        )
      ) : (
        value ? (
          <p className="text-sm text-green-900 leading-relaxed">{value}</p>
        ) : (
          <p className="text-sm text-green-900/30 italic">Not set — tap Edit to add</p>
        )
      )}
    </div>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 cursor-pointer"
    >
      <div
        className={`w-10 h-5 rounded-full transition-colors flex-shrink-0 ${checked ? 'bg-green-700' : 'bg-green-900/20'}`}
      >
        <div className={`w-4 h-4 rounded-full bg-white mt-0.5 transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </div>
      <span className="text-sm text-green-900/70">{label}</span>
    </button>
  )
}
