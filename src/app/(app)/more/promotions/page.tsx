'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/auth'
import { createClient } from '@/lib/supabase'
import TopBar from '@/components/ui/TopBar'
import { CardSkeleton } from '@/components/ui/Loading'
import { formatBookingDate } from '@/lib/utils'
import type { Promotion } from '@/types'

export default function PromotionsPage() {
  const { user } = useAuthStore()
  const router = useRouter()
  const [promotions, setPromotions] = useState<Promotion[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (user) loadPromotions()
  }, [user])

  async function loadPromotions() {
    const supabase = createClient()
    const courseId = user?.member?.home_course_id
    const { data } = await supabase
      .from('promotions')
      .select('*')
      .eq('active', true)
      .or(`course_id.is.null,course_id.eq.${courseId}`)
      .order('sort_order', { ascending: true })
    setPromotions((data ?? []) as Promotion[])
    setLoading(false)
  }

  return (
    <div>
      <div className="top-bar flex items-center gap-3">
        <button onClick={() => router.push('/more')} className="text-gold text-sm flex items-center gap-1">
          <BackArrow /> More
        </button>
        <div className="flex-1">
          <div className="logo-text">Member Offers</div>
          <div className="logo-subtitle">Curated · Exclusive</div>
        </div>
      </div>

      <div className="px-5 py-4 pb-8">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="promo-card p-4"><CardSkeleton lines={3} /></div>
            ))}
          </div>
        ) : promotions.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-3xl mb-3">🎁</p>
            <p className="font-serif text-xl text-green-900 mb-2">No offers right now</p>
            <p className="text-sm text-green-900/45">Check back soon — new member offers are added regularly.</p>
          </div>
        ) : (
          promotions.map(p => <PromoCard key={p.id} promo={p} />)
        )}
      </div>
    </div>
  )
}

function PromoCard({ promo }: { promo: Promotion }) {
  return (
    <div className="promo-card mb-4">
      <div className="promo-accent" />
      <div className="p-5">
        <p className="text-xs uppercase tracking-widest mb-2" style={{ color: '#85bb65' }}>
          {promo.badge_label}
        </p>
        <p className="font-serif text-xl text-white font-medium leading-snug mb-2">
          {promo.title}
        </p>
        <p className="text-sm text-white/55 leading-relaxed">
          {promo.description}
        </p>
        {promo.expires_at && (
          <p className="text-xs text-white/25 mt-3">
            Expires {formatBookingDate(promo.expires_at)}
          </p>
        )}
        {promo.cta_url && (
          <a
            href={promo.cta_url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-gold btn-sm mt-4 inline-flex"
          >
            {promo.cta_label}
          </a>
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
