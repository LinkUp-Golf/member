'use client'

import { useState, useEffect } from 'react'
import { useProfile } from '@/hooks/useProfile'
import { usePushNotifications } from '@/hooks/usePushNotifications'
import { Spinner } from '@/components/ui/Loading'

const TEXT_SIZE_MIN = 12
const TEXT_SIZE_MAX = 26
const TEXT_SIZE_DEFAULT = 16

interface NotifPrefs {
  new_member:      boolean
  booking:         boolean
  messages:        boolean
  focus_linkup:    boolean
  play_suggestion: boolean
  visiting_member: boolean
}

const DEFAULT_PREFS: NotifPrefs = {
  new_member:      true,
  booking:         true,
  messages:        true,
  focus_linkup:    true,
  play_suggestion: true,
  visiting_member: true,
}

const PREF_LABELS: Record<keyof NotifPrefs, { label: string; desc: string }> = {
  new_member:      { label: 'New members',         desc: 'When someone joins your community' },
  booking:         { label: 'Tee time bookings',   desc: 'When a member books a round' },
  messages:        { label: 'Messages',             desc: 'New direct and group messages' },
  focus_linkup:    { label: 'Focus LinkUps',        desc: '2-week and 1-week reminders for subscribed categories' },
  play_suggestion: { label: 'Play suggestions',     desc: 'When we suggest a member you haven\'t played with yet' },
  visiting_member: { label: 'Visiting members',     desc: 'When a guest member arrives in your community' },
}

export default function SettingsPage() {
  const { user, profile, signOut, refetch } = useProfile()
  const { permission, subscribed, requesting, requestPermission, unsubscribe } = usePushNotifications()

  const [prefs, setPrefs] = useState<NotifPrefs>(DEFAULT_PREFS)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const [textSize, setTextSize] = useState(TEXT_SIZE_DEFAULT)
  const [savingTextSize, setSavingTextSize] = useState(false)

  useEffect(() => {
    // Load saved preferences from localStorage
    const stored = localStorage.getItem('linkup-notif-prefs')
    if (stored) {
      try { setPrefs(JSON.parse(stored)) } catch {}
    }
  }, [])

  useEffect(() => {
    const saved = profile?.profile?.text_size
    if (saved) setTextSize(saved)
  }, [profile?.profile?.text_size])

  function applyTextSize(px: number) {
    document.documentElement.style.fontSize = `${px}px`
  }

  function handleSliderInput(px: number) {
    setTextSize(px)
    applyTextSize(px)
  }

  async function handleSliderCommit(px: number) {
    setSavingTextSize(true)
    try {
      await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text_size: px }),
      })
      await refetch()
    } finally {
      setSavingTextSize(false)
    }
  }

  function togglePref(key: keyof NotifPrefs) {
    setPrefs(prev => ({ ...prev, [key]: !prev[key] }))
  }

  async function savePrefs() {
    setSaving(true)
    localStorage.setItem('linkup-notif-prefs', JSON.stringify(prefs))
    await new Promise(r => setTimeout(r, 400)) // Small delay for feedback
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div>
      <div className="top-bar flex items-center justify-between">
        <div className="font-sans font-black text-2xl" style={{ color: 'var(--color-gold)' }}>Settings</div>
      </div>

      <div className="px-5 py-5 pb-8 space-y-6">

        {/* Push notifications master toggle */}
        <section>
          <p className="section-label mb-3">Push notifications</p>
          <div className="card card-pad">
            {permission === 'unsupported' ? (
              <p className="text-sm text-green-900/50 italic">
                Push notifications are not supported on this browser. Install the app on your home screen for notification support.
              </p>
            ) : permission === 'denied' ? (
              <div>
                <p className="text-sm text-green-900 font-medium mb-1">Notifications are blocked</p>
                <p className="text-xs text-green-900/55 leading-relaxed">
                  You&apos;ve blocked notifications for this app. To re-enable, go to your browser or device settings and allow notifications for app.linkup.golf.
                </p>
              </div>
            ) : subscribed ? (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-green-900">Notifications enabled</p>
                  <p className="text-xs text-green-900/45 mt-0.5">This device will receive LinkUp notifications</p>
                </div>
                <button onClick={unsubscribe} className="text-xs text-red-400">Disable</button>
              </div>
            ) : (
              <div>
                <p className="text-sm font-medium text-green-900 mb-1">Enable notifications</p>
                <p className="text-xs text-green-900/55 mb-3 leading-relaxed">
                  Get notified about messages, bookings, and community activity. You can customise which notifications you receive below.
                </p>
                <button
                  onClick={requestPermission}
                  disabled={requesting}
                  className="btn btn-primary btn-sm"
                >
                  {requesting ? <Spinner className="w-3.5 h-3.5 text-gold" /> : 'Enable notifications'}
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Notification type preferences */}
        {subscribed && (
          <section>
            <p className="section-label mb-3">Notification types</p>
            <div className="card">
              {(Object.keys(PREF_LABELS) as (keyof NotifPrefs)[]).map((key, i) => {
                const { label, desc } = PREF_LABELS[key]
                return (
                  <div
                    key={key}
                    className={`flex items-center justify-between px-4 py-3.5 ${
                      i < Object.keys(PREF_LABELS).length - 1 ? 'border-b border-green-900/08' : ''
                    }`}
                  >
                    <div className="flex-1 pr-4">
                      <p className="text-sm font-medium text-green-900">{label}</p>
                      <p className="text-xs text-green-900/45 mt-0.5">{desc}</p>
                    </div>
                    <Toggle
                      checked={prefs[key]}
                      onChange={() => togglePref(key)}
                    />
                  </div>
                )
              })}
            </div>

            <button
              onClick={savePrefs}
              disabled={saving}
              className="btn btn-gold btn-full mt-4"
            >
              {saving ? <Spinner className="w-4 h-4 text-green-900" /> :
               saved ? '✓ Saved' : 'Save preferences'}
            </button>
          </section>
        )}

        {/* Text size */}
        <section>
          <p className="section-label mb-3">Text size</p>
          <div className="card card-pad space-y-4">
            {/* Current value */}
            <div className="flex items-center justify-between">
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-black text-green-900 tabular-nums leading-none">{textSize}</span>
                <span className="text-sm text-green-900/45">px</span>
              </div>
              {textSize !== TEXT_SIZE_DEFAULT ? (
                <button
                  onClick={() => { handleSliderInput(TEXT_SIZE_DEFAULT); handleSliderCommit(TEXT_SIZE_DEFAULT) }}
                  disabled={savingTextSize}
                  className="text-xs text-green-900/45 underline underline-offset-2 disabled:opacity-40"
                >
                  Reset to default
                </button>
              ) : (
                <span className="text-xs text-green-900/30">Default</span>
              )}
            </div>

            {/* Slider */}
            <div className="flex items-center gap-3">
              <span className="text-sm text-green-900/35 leading-none select-none flex-shrink-0">A</span>
              <input
                type="range"
                min={TEXT_SIZE_MIN}
                max={TEXT_SIZE_MAX}
                step={1}
                value={textSize}
                onChange={e => handleSliderInput(Number(e.target.value))}
                onMouseUp={e => handleSliderCommit(Number((e.target as HTMLInputElement).value))}
                onTouchEnd={e => handleSliderCommit(Number((e.target as HTMLInputElement).value))}
                disabled={savingTextSize}
                className="text-size-slider flex-1"
                style={{ '--slider-fill': `${((textSize - TEXT_SIZE_MIN) / (TEXT_SIZE_MAX - TEXT_SIZE_MIN)) * 100}%` } as React.CSSProperties}
              />
              <span className="text-xl text-green-900/35 leading-none select-none flex-shrink-0">A</span>
            </div>

            {/* Min / max labels */}
            <div className="flex justify-between -mt-1">
              <span className="text-[11px] text-green-900/25">{TEXT_SIZE_MIN}px</span>
              <span className="text-[11px] text-green-900/25">{TEXT_SIZE_MAX}px</span>
            </div>
          </div>
        </section>

        {/* Account */}
        <section>
          <p className="section-label mb-3">Account</p>
          <div className="card">
            <div className="px-4 py-3.5 border-b border-green-900/08">
              <p className="text-xs text-green-900/40 mb-0.5">Email address</p>
              <p className="text-sm text-green-900">{user?.email}</p>
            </div>
            <div className="px-4 py-3.5 border-b border-green-900/08">
              <p className="text-xs text-green-900/40 mb-0.5">Home course</p>
              <p className="text-sm text-green-900">{profile?.home_course?.name ?? 'Aviara'}</p>
            </div>
            <div className="px-4 py-3.5">
              <p className="text-xs text-green-900/40 mb-0.5">Member since</p>
              <p className="text-sm text-green-900">
                {profile?.membership_start_date
                  ? new Date(profile.membership_start_date).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
                  : 'Active member'}
              </p>
            </div>
          </div>
        </section>

        {/* Sign out */}
        <button
          onClick={signOut}
          className="w-full text-center text-sm text-red-400 py-2"
        >
          Sign out of this device
        </button>

        <p className="text-center text-xs text-green-900/20 pb-2">
          LinkUp Golf · Member Portal · v1.0<br />
          app.linkup.golf
        </p>
      </div>
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={`w-11 h-6 rounded-full transition-colors flex-shrink-0 relative ${
        checked ? 'bg-green-800' : 'bg-green-900/15'
      }`}
      role="switch"
      aria-checked={checked}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
        checked ? 'translate-x-5' : 'translate-x-0'
      }`} />
    </button>
  )
}

