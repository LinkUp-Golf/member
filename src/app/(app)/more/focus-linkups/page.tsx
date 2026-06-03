'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useProfile } from '@/hooks/useProfile'
import { apiClient } from '@/lib/api-client'
import { Spinner } from '@/components/ui/Loading'
import AppShell from '@/components/layout/AppShell'
import { INDUSTRY_CATEGORIES, type IndustryCategory, type FocusLinkup } from '@/types'
import { format } from 'date-fns'

export default function FocusLinkupsPage() {
  const { user } = useProfile()
  const router = useRouter()
  const [subscribed, setSubscribed] = useState<Set<string>>(new Set())
  const [upcoming, setUpcoming] = useState<FocusLinkup[]>([])
  const [_loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState<string | null>(null)

  useEffect(() => {
    if (user) loadData()
  }, [user])

  async function loadData() {
    const response = await apiClient.get<{ linkups: FocusLinkup[]; subscriptions: string[] }>('/api/focus-linkups')
    if (response.data) {
      setSubscribed(new Set(response.data.subscriptions))
      setUpcoming(response.data.linkups)
    }
    setLoading(false)
  }

  async function toggleSubscription(category: IndustryCategory) {
    if (!user || toggling) return
    setToggling(category)

    if (subscribed.has(category)) {
      await apiClient.delete('/api/focus-linkups/subscriptions', { industry_focus: category })
      setSubscribed(prev => { const s = new Set(prev); s.delete(category); return s })
    } else {
      await apiClient.post('/api/focus-linkups/subscriptions', { industry_focus: category })
      setSubscribed(prev => new Set([...prev, category]))
    }
    setToggling(null)
  }

  return (
    <AppShell
      header={
        <div className="top-bar flex items-center justify-between">
          <div>
            <div className="font-sans font-black text-2xl" style={{ color: 'var(--color-gold)' }}>Focus LinkUps</div>
            <div className="logo-subtitle">Manage notifications</div>
          </div>
        </div>
      }
    >
      <div className="px-5 py-5 pb-8">
        {/* Explainer */}
        <div className="card card-pad mb-5">
          <p className="text-sm text-green-900 leading-relaxed">
            Focus LinkUps are themed golf days designed to bring together members from specific industries.
            Any member can play any day — subscribe to get notified 2 weeks and 1 week before Focus days relevant to you.
          </p>
        </div>

        {/* Subscriptions */}
        <p className="section-label mb-3">Notify me about</p>
        <div className="card mb-6">
          {INDUSTRY_CATEGORIES.map((cat, i) => {
            const isSubscribed = subscribed.has(cat)
            const isToggling = toggling === cat
            return (
              <div
                key={cat}
                className={`flex items-center justify-between px-4 py-3.5 ${
                  i < INDUSTRY_CATEGORIES.length - 1 ? 'border-b border-green-900/08' : ''
                }`}
              >
                <p className="text-sm text-green-900">{cat}</p>
                {isToggling ? (
                  <Spinner className="w-5 h-5 text-green-700" />
                ) : (
                  <button
                    onClick={() => toggleSubscription(cat)}
                    className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0 ${
                      isSubscribed ? 'bg-green-800' : 'bg-green-900/15'
                    }`}
                    role="switch"
                    aria-checked={isSubscribed}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${
                      isSubscribed ? 'translate-x-5' : 'translate-x-0'
                    }`} />
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {/* Upcoming Focus LinkUps */}
        <p className="section-label mb-3">Upcoming Focus LinkUps</p>
        {upcoming.length === 0 ? (
          <div
            className="rounded-2xl flex flex-col items-center text-center px-6 py-10"
            style={{ background: 'rgba(0,38,105,0.04)', border: '1.5px dashed rgba(0,38,105,0.12)' }}
          >
            <div className="text-3xl mb-3">⛳</div>
            <p className="font-sans font-black text-base text-green-900 mb-1">No upcoming dates yet</p>
            <p className="text-xs text-green-900/40 leading-relaxed max-w-xs">
              Focus LinkUp dates are scheduled throughout the season. Subscribe above to get notified when one relevant to your industry is announced.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {upcoming.map(fl => (
              <div key={fl.id} className="card card-pad">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-black text-green-900">{fl.title}</p>
                    <p className="text-xs text-green-900/50 mt-1">
                      {format(new Date(fl.focus_date + 'T12:00:00'), 'EEEE, MMMM d')} · {fl.tee_time.slice(0, 5)}
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {fl.industry_focus.map(f => (
                        <span key={f} className="tag text-xs">{f}</span>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => router.push(`/book?focusLinkup=${fl.id}&date=${fl.focus_date}`)}
                    className="btn btn-primary btn-sm flex-shrink-0"
                  >
                    Book
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  )
}

