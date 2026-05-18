'use client'

import { useState, useEffect } from 'react'
import { useAuthStore } from '@/store/auth'
import { createClient } from '@/lib/supabase'
import Avatar from '@/components/ui/Avatar'
import { Spinner } from '@/components/ui/Loading'
import { INDUSTRY_CATEGORIES } from '@/types'
import type { MemberProfile } from '@/types'

export default function MyProfilePage() {
  const { user, refreshMember } = useAuthStore()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<Partial<MemberProfile>>({})

  useEffect(() => {
    if (user?.member?.profile) {
      setForm(user.member.profile)
    }
  }, [user])

  function set(field: keyof MemberProfile, value: unknown) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function save() {
    if (!user) return
    setSaving(true)
    const supabase = createClient()

    const { error } = await supabase
      .from('member_profiles')
      .update({
        display_name: form.display_name,
        business_name: form.business_name,
        business_description: form.business_description,
        role_title: form.role_title,
        industry_category: form.industry_category,
        value_offered: form.value_offered,
        value_sought: form.value_sought,
        non_golf_hobbies: form.non_golf_hobbies,
        handicap_index: form.handicap_index ?? null,
        show_handicap: form.show_handicap ?? false,
        preferred_play_times: form.preferred_play_times,
        play_frequency: form.play_frequency,
        open_to_golf_travel: form.open_to_golf_travel ?? false,
        family_golfers: form.family_golfers,
        profile_visible: form.profile_visible ?? true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)

    if (!error) {
      await refreshMember()
      setEditing(false)
    }
    setSaving(false)
  }

  if (!user) return null
  const m = user.member

  return (
    <div>
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
        <h1 className="font-serif text-2xl text-white font-medium">
          {m.first_name} {m.last_name}
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
          label="About my business"
          value={form.business_description}
          editing={editing}
          multiline
          placeholder="Describe what your business does, your experience, and what makes you distinctive…"
          onChange={v => set('business_description', v)}
        />

        <Field
          label="My role & company"
          value={form.role_title}
          editing={editing}
          placeholder="e.g. CEO, McKenna Infrastructure Group"
          onChange={v => set('role_title', v)}
          extra={
            editing ? (
              <input
                className="input mt-2"
                placeholder="Business name"
                value={form.business_name ?? ''}
                onChange={e => set('business_name', e.target.value)}
              />
            ) : form.business_name ? (
              <p className="text-sm text-green-900/60 mt-1">{form.business_name}</p>
            ) : null
          }
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
          label="Beyond the office"
          value={form.non_golf_hobbies}
          editing={editing}
          multiline
          placeholder="Your hobbies, interests, and life outside of work…"
          onChange={v => set('non_golf_hobbies', v)}
        />

        {/* Golf life */}
        <div className="px-5 py-4 border-b border-green-900/08">
          <p className="text-xs uppercase tracking-widest text-green-900/40 mb-3">Golf life</p>

          {editing ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-green-900/50 mb-1 block">Handicap (optional)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="54"
                    className="input"
                    placeholder="e.g. 11.4"
                    value={form.handicap_index ?? ''}
                    onChange={e => set('handicap_index', e.target.value ? parseFloat(e.target.value) : null)}
                  />
                </div>
                <div>
                  <label className="text-xs text-green-900/50 mb-1 block">Play frequency</label>
                  <input
                    className="input"
                    placeholder="e.g. 2–3× per month"
                    value={form.play_frequency ?? ''}
                    onChange={e => set('play_frequency', e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-green-900/50 mb-1 block">Preferred tee times</label>
                <input
                  className="input"
                  placeholder="e.g. Early mornings, weekdays"
                  value={form.preferred_play_times ?? ''}
                  onChange={e => set('preferred_play_times', e.target.value)}
                />
              </div>
              <div className="flex items-center gap-3">
                <Toggle
                  label="Open to golf travel"
                  checked={form.open_to_golf_travel ?? false}
                  onChange={v => set('open_to_golf_travel', v)}
                />
                <Toggle
                  label="Show handicap"
                  checked={form.show_handicap ?? false}
                  onChange={v => set('show_handicap', v)}
                />
              </div>
              <div>
                <label className="text-xs text-green-900/50 mb-1 block">Family golf details</label>
                <textarea
                  className="input resize-none"
                  rows={2}
                  placeholder="e.g. Wife plays occasionally. Son (14) is learning."
                  value={form.family_golfers ?? ''}
                  onChange={e => set('family_golfers', e.target.value)}
                />
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 mb-3">
                {form.handicap_index !== null && form.handicap_index !== undefined && form.show_handicap && (
                  <GolfStat value={String(form.handicap_index)} label="Handicap" />
                )}
                {form.play_frequency && <GolfStat value={form.play_frequency} label="Frequency" />}
                {form.preferred_play_times && <GolfStat value={form.preferred_play_times} label="Preferred" />}
                <GolfStat value={form.open_to_golf_travel ? 'Yes' : 'No'} label="Golf travel" />
              </div>
              {form.family_golfers && (
                <p className="text-sm text-green-900/60 leading-relaxed">{form.family_golfers}</p>
              )}
            </>
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
    </div>
  )
}

// ---- Sub-components -----------------------------------------

function Field({
  label, value, editing, multiline, placeholder, onChange, extra,
}: {
  label: string
  value?: string | null
  editing: boolean
  multiline?: boolean
  placeholder?: string
  onChange: (v: string) => void
  extra?: React.ReactNode
}) {
  return (
    <div className="px-5 py-4 border-b border-green-900/08">
      <p className="text-xs uppercase tracking-widest text-green-900/40 mb-2">{label}</p>
      {editing ? (
        <>
          {multiline ? (
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
          )}
          {extra}
        </>
      ) : (
        <>
          {value ? (
            <p className="text-sm text-green-900 leading-relaxed">{value}</p>
          ) : (
            <p className="text-sm text-green-900/30 italic">Not set — tap Edit to add</p>
          )}
          {extra}
        </>
      )}
    </div>
  )
}

function GolfStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="bg-green-50 rounded-xl p-3 text-center">
      <p className="font-serif text-xl font-semibold text-green-900">{value}</p>
      <p className="text-xs text-green-900/40 mt-1">{label}</p>
    </div>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <div
        onClick={() => onChange(!checked)}
        className={`w-10 h-5 rounded-full transition-colors flex-shrink-0 ${checked ? 'bg-green-700' : 'bg-green-900/20'}`}
      >
        <div className={`w-4 h-4 rounded-full bg-white mt-0.5 transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </div>
      <span className="text-sm text-green-900/70">{label}</span>
    </label>
  )
}
