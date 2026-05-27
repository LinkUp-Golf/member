'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/auth'
import { apiClient } from '@/lib/api-client'
import AppShell from '@/components/layout/AppShell'
import { formatBookingDate } from '@/lib/utils'
import type { Promotion } from '@/types'

export default function PromotionDetailPage() {
  const { user } = useAuthStore()
  const router = useRouter()
  const params = useParams()
  const id = params['id'] as string

  const [promo, setPromo] = useState<Promotion | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (user && id) load()
  }, [user, id])

  async function load() {
    const res = await apiClient.get<Promotion[]>('/api/promotions')
    const found = res.data?.find(p => p.id === id) ?? null
    if (!found) setNotFound(true)
    else setPromo(found)
    setLoading(false)
  }

  return (
    <AppShell
      header={
        <div className="top-bar flex items-center justify-between">
          <div>
            <div className="logo-text">Member Offer</div>
          </div>
          <button onClick={() => router.back()} className="text-gold text-sm">
            Back
          </button>
        </div>
      }
    >
      <div className="pb-12">
        {loading ? (
          <div className="p-5 space-y-4 animate-pulse">
            <div className="h-48 bg-green-900/10 rounded-2xl" />
            <div className="h-4 bg-green-900/10 rounded w-1/3" />
            <div className="h-6 bg-green-900/10 rounded w-3/4" />
            <div className="h-20 bg-green-900/10 rounded" />
          </div>
        ) : notFound || !promo ? (
          <div className="text-center py-20 px-8">
            <p className="text-3xl mb-3">🎁</p>
            <p className="font-serif text-xl text-green-900 mb-2">Offer not found</p>
            <p className="text-sm text-green-900/45">This offer may have expired or been removed.</p>
          </div>
        ) : (
          <article>
            {promo.image_url && (
              <img
                src={promo.image_url}
                alt=""
                className="w-full max-h-72 object-cover"
              />
            )}
            {!promo.image_url && promo.video_url && (
              <video
                src={promo.video_url}
                controls
                playsInline
                className="w-full max-h-72 bg-black"
              />
            )}

            <div className="px-5 py-6">
              <p className="text-xs uppercase tracking-widest mb-2" style={{ color: '#85bb65' }}>
                {promo.badge_label}
              </p>
              <h1 className="font-serif text-2xl text-green-900 font-medium leading-snug mb-3">
                {promo.title}
              </h1>
              <p className="text-sm text-green-900/45 mb-1">{promo.partner_name}</p>

              {promo.expires_at && (
                <p className="text-xs text-green-900/30 mb-4">
                  Expires {formatBookingDate(promo.expires_at)}
                </p>
              )}

              <p className="text-sm text-green-900/70 leading-relaxed whitespace-pre-wrap mb-6">
                {promo.description}
              </p>

              {promo.cta_url && (
                <a
                  href={promo.cta_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-gold inline-flex"
                >
                  {promo.cta_label}
                </a>
              )}
            </div>
          </article>
        )}
      </div>
    </AppShell>
  )
}
