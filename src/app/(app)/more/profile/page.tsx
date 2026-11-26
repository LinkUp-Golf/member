'use client'

import { useState, useEffect, useRef } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import { useProfile } from '@/hooks/useProfile'
import { apiClient } from '@/lib/api-client'
import Avatar from '@/components/ui/Avatar'
import { Spinner } from '@/components/ui/Loading'
import AppShell from '@/components/layout/AppShell'
import { INDUSTRY_CATEGORIES } from '@/types'
import Select from '@/components/ui/Select'
import InfoBubble from '@/components/ui/InfoBubble'
import { parseNonprofits, formatNonprofits, MAX_NONPROFITS } from '@/lib/profile/nonprofits'
import type { MemberProfile } from '@/types'

export default function MyProfilePage() {
  const { profile, refetch } = useProfile()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<Partial<MemberProfile>>({})
  // The textarea holds raw text, not the stored array — keeping it separate
  // means a half-typed line or a trailing newline survives editing instead of
  // being normalised away under the cursor.
  const [nonprofitsText, setNonprofitsText] = useState('')
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [avatarError, setAvatarError] = useState('')
  const [saveError, setSaveError] = useState('')
  const avatarInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (profile?.profile) {
      setForm(profile.profile)
      setNonprofitsText(formatNonprofits(profile.profile.nonprofits))
    }
  }, [profile])

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setAvatarError('')

    // Client-side validation before touching the network
    const ALLOWED = ['image/jpeg', 'image/png', 'image/webp']
    if (!ALLOWED.includes(file.type)) {
      setAvatarError('Please choose a JPEG, PNG, or WebP image.')
      e.target.value = ''
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setAvatarError('Image must be 5 MB or smaller.')
      e.target.value = ''
      return
    }

    setUploadingAvatar(true)
    try {
      const data = new FormData()
      data.append('file', file)
      const res = await fetch('/api/profile/avatar', { method: 'POST', body: data })
      if (res.ok) {
        await refetch()
      } else {
        const body = await res.json().catch(() => ({}))
        setAvatarError(body.error ?? 'Upload failed. Please try again.')
      }
    } catch {
      setAvatarError('Network error. Check your connection and try again.')
    } finally {
      setUploadingAvatar(false)
      e.target.value = ''
    }
  }

  function set(field: keyof MemberProfile, value: unknown) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function save() {
    if (!profile) return
    setSaving(true)
    setSaveError('')

    const response = await apiClient.patch('/api/profile', {
      display_name: form.display_name,
      business_name: form.business_name,
      business_description: form.business_description,
      role_title: form.role_title,
      industry_category: form.industry_category,
      value_offered: form.value_offered,
      value_sought: form.value_sought,
      non_golf_hobbies: form.non_golf_hobbies,
      golfer_description: form.golfer_description,
      // Raw text — the server parses it, so the split/trim/dedupe rules can't
      // drift between here and the GHL sync.
      nonprofits: nonprofitsText,
      linkedin_url: form.linkedin_url ?? null,
      profile_visible: form.profile_visible ?? true,
    })

    if (!response.error) {
      await refetch()
      setEditing(false)
    } else {
      setSaveError(response.error.message || 'Failed to save. Please try again.')
    }
    setSaving(false)
  }

  // Keyed on the profile alone: it comes from the server session, and the
  // browser client's `user` can be missing while that session is fine.
  if (!profile) return null
  const m = profile

  // Counted from the parsed result, not the line count — blank lines and
  // duplicates don't cost the member one of their three.
  const nonprofits = parseNonprofits(nonprofitsText)
  const tooManyNonprofits = nonprofits.length > MAX_NONPROFITS

  const headline = [m.profile?.role_title, m.profile?.business_name]
    .map(s => s?.trim())
    .filter(Boolean)
    .join(' · ')

  return (
    <AppShell title="Profile" description="Your member details">
      {/* Header */}
      <div className="bg-green-900 px-5 pt-5 pb-6 text-center">
        <div className="flex justify-center mb-3">
          <button
            type="button"
            className="relative group"
            onClick={() => avatarInputRef.current?.click()}
            disabled={uploadingAvatar}
            aria-label="Change profile photo"
          >
            <Avatar
              firstName={m.first_name}
              lastName={m.last_name}
              avatarUrl={m.profile?.avatar_url}
              size="xl"
            />
            {/* Spinner overlay while uploading */}
            {uploadingAvatar && (
              <div className="absolute inset-0 rounded-full flex items-center justify-center bg-green-950/60">
                <Spinner className="w-6 h-6 text-gold" />
              </div>
            )}
            {/* Camera badge */}
            {!uploadingAvatar && (
              <span className="absolute bottom-0 right-0 w-6 h-6 rounded-full flex items-center justify-center border-2 border-green-900" style={{ background: 'var(--color-gold)' }}>
                <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-green-950)' }}>
                  <path d="M14 11.5A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5v-6A1.5 1.5 0 0 1 3.5 4h1.25L6 2h4l1.25 2H12.5A1.5 1.5 0 0 1 14 5.5v6Z" />
                  <circle cx="8" cy="8.5" r="2" />
                </svg>
              </span>
            )}
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={handleAvatarChange}
            />
          </button>
        </div>
        {avatarError && (
          <p className="text-xs text-red-300 mb-2">{avatarError}</p>
        )}
        <h1 className="font-sans font-black text-2xl text-white capitalize">
          {m.first_name} {m.last_name}
        </h1>
        {/* Either half alone still shows: this line is the only place title
            and organization appear outside edit mode, and it used to vanish
            for a member with an organization but no title. */}
        {headline && (
          <p className="text-sm text-white/50 mt-1">{headline}</p>
        )}
        <div className="flex gap-2 justify-center flex-wrap mt-3">
          {m.home_course?.city && (
            <span className="profile-tag">{m.home_course.city}</span>
          )}
          {m.membership_start_date && (
            <span className="profile-tag">
              {/* membership_start_date is a plain calendar date, not an instant —
                  read the year in UTC so a Jan 1 start date doesn't show as the
                  previous year for anyone west of UTC. */}
              Member since {formatInTimeZone(new Date(m.membership_start_date), 'UTC', 'yyyy')}
            </span>
          )}
        </div>
      </div>

      {/* Edit / Save toggle */}
      <div className="px-5 py-4">
        {editing ? (
          <>
            {saveError && (
              <p className="text-xs text-red-500 mb-2">{saveError}</p>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setEditing(false)
                  setForm(m.profile ?? {})
                  setNonprofitsText(formatNonprofits(m.profile?.nonprofits))
                }}
                className="btn btn-outline flex-1 justify-center"
                disabled={saving}
              >
                Cancel
              </button>
              <button
                onClick={save}
                className="btn btn-gold flex-1 justify-center"
                // Held back rather than letting the save round-trip and fail:
                // the field says what's wrong, and the fix is right there.
                disabled={saving || tooManyNonprofits}
              >
                {saving ? <Spinner className="w-4 h-4" /> : 'Save changes'}
              </button>
            </div>
          </>
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
        {/* Title and organization: edited here, side by side, but not repeated
            while viewing — the header under the photo already reads
            "Title · Organization", and a second copy two inches below it was
            the same line twice. */}
        {editing && (
          <div className="px-5 py-4 border-b border-green-900/08 grid grid-cols-2 gap-3">
            <label className="block min-w-0">
              <span className="block text-xs uppercase tracking-widest text-green-900/40 mb-2">Title</span>
              <input
                className="input"
                placeholder="e.g. CEO"
                value={form.role_title ?? ''}
                onChange={e => set('role_title', e.target.value)}
              />
            </label>
            <label className="block min-w-0">
              <span className="block text-xs uppercase tracking-widest text-green-900/40 mb-2">Organization</span>
              <input
                className="input"
                placeholder="e.g. McKenna Infrastructure Group"
                value={form.business_name ?? ''}
                onChange={e => set('business_name', e.target.value)}
              />
            </label>
          </div>
        )}

        {/* Professional / Personal / Golfer Summary: the client's labels
            (2026-11-25), and the same three headings an Introduce Me email
            prints, so a member filling these in is writing their introduction.
            The columns keep their old names — business_description was "Intro
            message", non_golf_hobbies was "Hobbies". */}
        <Field
          label="Professional Summary"
          value={form.business_description}
          editing={editing}
          multiline
          placeholder="Who you are, what you do, and what makes you distinctive…"
          onChange={v => set('business_description', v)}
        />

        <Field
          label="Personal Summary"
          value={form.non_golf_hobbies}
          editing={editing}
          multiline
          placeholder="Your interests, family, and life outside of work…"
          onChange={v => set('non_golf_hobbies', v)}
        />

        <Field
          label="Golfer Summary"
          value={form.golfer_description}
          editing={editing}
          multiline
          placeholder="Describe yourself as a golfer — how you play, how often, what you enjoy about the game…"
          onChange={v => set('golfer_description', v)}
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
            <Select
              options={INDUSTRY_CATEGORIES.map(c => ({ value: c, label: c }))}
              value={form.industry_category ?? ''}
              onChange={v => set('industry_category', v)}
              placeholder="Select a category…"
              searchPlaceholder="Search categories…"
            />
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

        <NonprofitsField
          editing={editing}
          text={nonprofitsText}
          parsed={nonprofits}
          onChange={setNonprofitsText}
        />

        {/* Focus LinkUps groups were listed here, read-only, and removed at
            the client's request (2026-11-25): they're managed on More → Focus
            LinkUps, and a section you can't change from here was noise. */}

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

// One per line, up to three. A textarea rather than three inputs: most members
// support one, and three empty boxes ask for more than they have.
function NonprofitsField({
  editing, text, parsed, onChange,
}: {
  editing: boolean
  /** Raw textarea contents. */
  text: string
  /** Cleaned entries — what will actually be saved and shown. */
  parsed: string[]
  onChange: (v: string) => void
}) {
  const over = parsed.length > MAX_NONPROFITS

  return (
    <div className="px-5 py-4 border-b border-green-900/08">
      <p className="text-xs uppercase tracking-widest text-green-900/40 mb-2 flex items-center gap-1.5">
        Non-profits
        <InfoBubble
          label="non-profits"
          text="The non-profits in your community you would like LinkUp to support."
        />
      </p>
      {editing ? (
        <>
          <textarea
            className={`input resize-none ${over ? 'border-red-400' : ''}`}
            rows={3}
            placeholder={'One per line, e.g.\nBoys & Girls Club\nHabitat for Humanity'}
            value={text}
            onChange={e => onChange(e.target.value)}
            aria-invalid={over}
            aria-describedby="nonprofits-help"
          />
          <p
            id="nonprofits-help"
            className={`text-xs mt-1.5 ${over ? 'text-red-500 font-medium' : 'text-green-900/40'}`}
          >
            {over
              ? `That's ${parsed.length}. Please keep it to ${MAX_NONPROFITS} — remove ${parsed.length - MAX_NONPROFITS}.`
              : `One per line, up to ${MAX_NONPROFITS}. ${parsed.length} of ${MAX_NONPROFITS} used.`}
          </p>
        </>
      ) : parsed.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {parsed.map(n => (
            <span key={n} className="text-xs bg-green-50 text-green-900 px-2.5 py-1 rounded-full border border-green-900/10">
              {n}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-sm text-green-900/30 italic">Not set — tap Edit to add</p>
      )}
    </div>
  )
}

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
