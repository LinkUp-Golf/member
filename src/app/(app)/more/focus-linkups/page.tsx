'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/auth'
import { createClient } from '@/lib/supabase'
import { Spinner } from '@/components/ui/Loading'
import { INDUSTRY_CATEGORIES, type IndustryCategory } from '@/types'
import { format } from 'date-fns'
import type { FocusLinkup } from '@/types'

export default function FocusLinkupsPage() {
  const { user } = useAuthStore()
  const router = useRouter()
  const [subscribed, setSubscribed] = useState<Set<string>>(new Set())
  const [upcoming, setUpcoming] = useState<FocusLinkup[]>([])
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState<string | null>(null)

  useEffect(() => {
    if (user) loadData()
  }, [user])

  async function loadData() {
    const supabase = createClient()
    const courseId = user?.member?.home_course_id

    const [subRes, linkupRes] = await Promise.all([
      supabase
        .from('focus_linkup_subscriptions')
        .select('industry_focus')
        .eq('member_id', user!.id),
      supabase
        .from('focus_linkups')
        .select('*')
        .eq('course_id', courseId)
        .gte('focus_date', new Date().toISOString().split('T')[0])
        .order('focus_date', { ascending: true })
        .limit(10),
    ])

    setSubscribed(new Set(subRes.data?.map(s => s.industry_focus) ?? []))
    setUpcoming((linkupRes.data ?? []) as FocusLinkup[])
    setLoading(false)
  }

  async function toggleSubscription(category: IndustryCategory) {
    if (!user || toggling) return
    setToggling(category)
    const supabase = createClient()

    if (subscribed.has(category)) {
      await supabase
        .from('focus_linkup_subscriptions')
        .delete()
        .eq('member_id', user.id)
        .eq('industry_focus', category)
      setSubscribed(prev => { const s = new Set(prev); s.delete(category); return s })
    } else {
      await supabase
        .from('focus_linkup_subscriptions')
        .insert({ member_id: user.id, industry_focus: category })
      setSubscribed(prev => new Set([...prev, category]))
    }
    setToggling(null)
  }

  return (
    <div>
      <div className="top-bar flex items-center gap-3">
        <button onClick={() => router.push('/more')} className="text-gold text-sm flex items-center gap-1">
          <BackArrow /> More
        </button>
        <div className="flex-1">
          <div className="logo-text">Focus LinkUps</div>
          <div className="logo-subtitle">Manage notifications</div>
        </div>
      </div>

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
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                      isSubscribed ? 'translate-x-5' : 'translate-x-0.5'
                    }`} />
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {/* Upcoming Focus LinkUps */}
        {upcoming.length > 0 && (
          <>
            <p className="section-label mb-3">Upcoming Focus LinkUps</p>
            <div className="space-y-3">
              {upcoming.map(fl => (
                <div key={fl.id} className="card card-pad">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-green-900">{fl.title}</p>
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
          </>
        )}
      </div>
    </div>
  )
}

function BackArrow() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
    </svg>
  )
}
