'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { useAuthStore } from '@/store/auth'
import { apiClient } from '@/lib/api-client'
import AppShell from '@/components/layout/AppShell'
import { formatBookingDate } from '@/lib/utils'
import type { Promotion } from '@/types'

export default function PromotionDetailPage() {
  const { user } = useAuthStore()
  const params = useParams()
  const id = params['id'] as string

  const [promo, setPromo] = useState<Promotion | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const load = useCallback(async () => {
    const res = await apiClient.get<Promotion[]>('/api/promotions')
    const found = res.data?.find(p => p.id === id) ?? null
    if (!found) setNotFound(true)
    else setPromo(found)
    setLoading(false)
  }, [id])

  useEffect(() => {
    if (user && id) load()
  }, [user, id, load])

  return (
    <AppShell
      header={
        <div className="top-bar flex items-center justify-between">
          <div>
            <div className="logo-text">Member Offer</div>
          </div>
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
            <p className="font-sans font-black text-xl text-green-900 mb-2">Offer not found</p>
            <p className="text-sm text-green-900/45">This offer may have expired or been removed.</p>
          </div>
        ) : (
          <article>
            <PromoMediaCarousel
              mediaUrls={promo.media_urls ?? []}
              imageUrl={promo.image_url}
              videoUrl={promo.video_url}
            />

            <div className="px-5 py-6">
              <p className="text-xs uppercase tracking-widest mb-2" style={{ color: '#85bb65' }}>
                {promo.badge_label}
              </p>
              <h1 className="font-sans font-black text-2xl text-green-900 leading-snug mb-3">
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

// ---- Media carousel -----------------------------------------

type MediaItem = { type: 'image' | 'video'; url: string }

function mediaTypeFromUrl(url: string): 'image' | 'video' {
  const ext = url.split('?')[0]?.split('.').pop()?.toLowerCase() ?? ''
  return ['mp4', 'webm', 'mov', 'quicktime'].includes(ext) ? 'video' : 'image'
}

function PromoMediaCarousel({ mediaUrls, imageUrl, videoUrl }: { mediaUrls: string[]; imageUrl: string | null; videoUrl: string | null }) {
  const items: MediaItem[] = mediaUrls.length
    ? mediaUrls.map(url => ({ type: mediaTypeFromUrl(url), url }))
    : [
        ...(imageUrl ? [{ type: 'image' as const, url: imageUrl }] : []),
        ...(videoUrl ? [{ type: 'video' as const, url: videoUrl }] : []),
      ]

  const [current, setCurrent] = useState(0)
  const [touchStartX, setTouchStartX] = useState<number | null>(null)

  if (items.length === 0) return null

  function handleTouchStart(e: React.TouchEvent) { setTouchStartX(e.touches[0]?.clientX ?? null) }
  function handleTouchEnd(e: React.TouchEvent) {
    if (touchStartX === null) return
    const delta = touchStartX - (e.changedTouches[0]?.clientX ?? touchStartX)
    if (delta > 48 && current < items.length - 1) setCurrent(c => c + 1)
    if (delta < -48 && current > 0) setCurrent(c => c - 1)
    setTouchStartX(null)
  }

  return (
    <div className="mb-0">
      <div
        className="relative overflow-hidden bg-black"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div
          className="flex items-start transition-transform duration-300 ease-in-out"
          style={{ transform: `translateX(-${current * 100}%)` }}
        >
          {items.map((item, i) => (
            <div key={i} className="flex-shrink-0 w-full">
              {item.type === 'image' ? (
                <img src={item.url} alt="" className="w-full max-h-72 object-contain block" draggable={false} />
              ) : (
                <video src={item.url} controls playsInline className="w-full max-h-72 object-contain block bg-black" />
              )}
            </div>
          ))}
        </div>
        {items.length > 1 && (
          <>
            {current > 0 && (
              <button onClick={() => setCurrent(c => c - 1)} className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)' }} aria-label="Previous">
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
              </button>
            )}
            {current < items.length - 1 && (
              <button onClick={() => setCurrent(c => c + 1)} className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)' }} aria-label="Next">
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
              </button>
            )}
          </>
        )}
      </div>
      {items.length > 1 && (
        <div className="flex justify-center gap-1.5 py-2.5 bg-black">
          {items.map((_, i) => (
            <button key={i} onClick={() => setCurrent(i)} className={`rounded-full transition-all duration-200 ${i === current ? 'w-4 h-1.5 bg-white/80' : 'w-1.5 h-1.5 bg-white/25'}`} aria-label={`Slide ${i + 1}`} />
          ))}
        </div>
      )}
    </div>
  )
}
