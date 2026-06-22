'use client'

import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import { useParams } from 'next/navigation'
import { useProfile } from '@/hooks/useProfile'
import { apiClient } from '@/lib/api-client'
import AppShell from '@/components/layout/AppShell'
import { formatRelativeTime } from '@/lib/utils'
import type { Announcement } from '@/types'

const TYPE_ICONS: Record<string, string> = {
  new_member:      '👋',
  booking:         '⛳',
  visiting_member: '✈️',
  member_event:    '📅',
  admin_broadcast: '📢',
  focus_linkup:    '🎯',
}

const TYPE_LABELS: Record<string, string> = {
  new_member:      'New member',
  booking:         'Tee time',
  visiting_member: 'Visiting member',
  member_event:    'Member event',
  admin_broadcast: 'Announcement',
  focus_linkup:    'Focus LinkUp',
}

export default function AnnouncementDetailPage() {
  const { user } = useProfile()
  const params = useParams()
  const id = params['id'] as string

  const [announcement, setAnnouncement] = useState<Announcement | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const load = useCallback(async () => {
    const res = await apiClient.get<Announcement[]>('/api/announcements?limit=50')
    const found = res.data?.find(a => a.id === id) ?? null
    if (!found) setNotFound(true)
    else setAnnouncement(found)
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
            <div className="font-sans font-black text-2xl" style={{ color: 'var(--color-gold)' }}>Announcement</div>
          </div>
        </div>
      }
    >
      <div className="px-5 py-6 pb-12">
        {loading ? (
          <div className="space-y-4 animate-pulse">
            <div className="h-4 bg-green-900/10 rounded w-1/3" />
            <div className="h-6 bg-green-900/10 rounded w-3/4" />
            <div className="h-56 bg-green-900/10 rounded-2xl" />
          </div>
        ) : notFound || !announcement ? (
          <div className="text-center py-20">
            <p className="text-3xl mb-3">📢</p>
            <p className="font-sans font-black text-xl text-green-900 mb-2">Not found</p>
            <p className="text-sm text-green-900/45">This announcement is no longer available.</p>
          </div>
        ) : (
          <article>
            {announcement.is_pinned && (
              <div
                className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full mb-3"
                style={{ background: 'rgba(200,160,60,0.12)', color: 'rgba(160,120,20,1)', border: '1px solid rgba(200,160,60,0.25)' }}
              >
                📌 Pinned announcement
              </div>
            )}
            <div className="flex items-center gap-2 mb-3">
              <span className="text-2xl">{TYPE_ICONS[announcement.type] ?? '📢'}</span>
              <span className="text-xs uppercase tracking-wider text-green-900/35">
                {TYPE_LABELS[announcement.type] ?? announcement.type}
              </span>
              <span className="text-xs text-green-900/25">·</span>
              <span className="text-xs text-green-900/35">
                {formatRelativeTime(announcement.published_at ?? announcement.created_at)}
              </span>
            </div>

            <h1 className="font-sans font-black text-2xl text-green-900 leading-snug mb-4">
              {announcement.title}
            </h1>

            <MediaCarousel
              mediaUrls={announcement.media_urls ?? []}
              imageUrl={announcement.image_url}
              videoUrl={announcement.video_url}
            />

            <p className="text-sm text-green-900/70 leading-relaxed whitespace-pre-wrap">
              {announcement.body}
            </p>
          </article>
        )}
      </div>
    </AppShell>
  )
}

// ---- Media carousel -----------------------------------------

type MediaItem = { type: 'image'; url: string } | { type: 'video'; url: string }

function mediaTypeFromUrl(url: string): 'image' | 'video' {
  const ext = url.split('?')[0]?.split('.').pop()?.toLowerCase() ?? ''
  return ['mp4', 'webm', 'mov', 'quicktime'].includes(ext) ? 'video' : 'image'
}

function MediaCarousel({
  mediaUrls,
  imageUrl,
  videoUrl,
}: {
  mediaUrls: string[]
  imageUrl: string | null
  videoUrl: string | null
}) {
  // Prefer the full array; fall back to legacy single fields for old records.
  const items: MediaItem[] = mediaUrls.length
    ? mediaUrls.map(url => ({ type: mediaTypeFromUrl(url), url }))
    : [
        ...(imageUrl ? [{ type: 'image' as const, url: imageUrl }] : []),
        ...(videoUrl ? [{ type: 'video' as const, url: videoUrl }] : []),
      ]

  const [current, setCurrent] = useState(0)
  const [touchStartX, setTouchStartX] = useState<number | null>(null)

  if (items.length === 0) return null

  function handleTouchStart(e: React.TouchEvent) {
    setTouchStartX(e.touches[0]?.clientX ?? null)
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (touchStartX === null) return
    const delta = touchStartX - (e.changedTouches[0]?.clientX ?? touchStartX)
    if (delta > 48 && current < items.length - 1) setCurrent(c => c + 1)
    if (delta < -48 && current > 0) setCurrent(c => c - 1)
    setTouchStartX(null)
  }

  return (
    <div className="mb-5">
      {/* Slide track */}
      <div
        className="relative rounded-2xl overflow-hidden bg-black"
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
                <div className="relative w-full h-72">
                  <Image src={item.url} alt="" fill className="object-contain" />
                </div>
              ) : (
                <video
                  src={item.url}
                  controls
                  playsInline
                  className="w-full max-h-72 object-contain block bg-black"
                />
              )}
            </div>
          ))}
        </div>

        {/* Prev / next arrows for non-touch */}
        {items.length > 1 && (
          <>
            {current > 0 && (
              <button
                onClick={() => setCurrent(c => c - 1)}
                className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center"
                style={{ background: 'rgba(0,0,0,0.45)' }}
                aria-label="Previous"
              >
                <ChevronLeft />
              </button>
            )}
            {current < items.length - 1 && (
              <button
                onClick={() => setCurrent(c => c + 1)}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center"
                style={{ background: 'rgba(0,0,0,0.45)' }}
                aria-label="Next"
              >
                <ChevronRight />
              </button>
            )}
          </>
        )}
      </div>

      {/* Dot indicators */}
      {items.length > 1 && (
        <div className="flex justify-center gap-1.5 mt-2.5">
          {items.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              className={`rounded-full transition-all duration-200 ${
                i === current
                  ? 'w-4 h-1.5 bg-green-700'
                  : 'w-1.5 h-1.5 bg-green-900/20'
              }`}
              aria-label={`Go to slide ${i + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ChevronLeft() {
  return (
    <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
    </svg>
  )
}

function ChevronRight() {
  return (
    <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
    </svg>
  )
}
