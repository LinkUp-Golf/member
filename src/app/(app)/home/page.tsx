"use client";

import { useEffect, useState, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useProfile } from "@/hooks/useProfile";
import { apiClient } from "@/lib/api-client";
import { formatBookingDate, formatTeeTime, truncate, formatRelativeTime } from "@/lib/utils";
import Avatar from "@/components/ui/Avatar";
import EmptyState from "@/components/ui/EmptyState";
import AppShell from '@/components/layout/AppShell';
import InstallBanner from '@/components/ui/InstallBanner';
import Icon, { type IconName } from '@/components/ui/Icon';
import NotificationBell from '@/components/ui/NotificationBell';
import MessagesIcon from '@/components/ui/MessagesIcon';
import { CardSkeleton, MemberRowSkeleton } from "@/components/ui/Loading";
import type {
  Booking,
  Announcement,
  Promotion,
  MemberWithProfile,
} from "@/types";

export default function HomePage() {
  const { user, profile, loading: authLoading, refetch } = useProfile();
  const [nextBooking, setNextBooking] = useState<Booking | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [newMembers, setNewMembers] = useState<MemberWithProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const [greeting, setGreeting] = useState('');
  const firstName = profile?.first_name ?? "";

  useEffect(() => {
    setGreeting(getGreeting());
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      // Auth resolved but no session — retry profile fetch once in case of race
      refetch();
      setLoading(false);
      return;
    }
    loadHomeData();
  }, [user, authLoading, refetch]);

  async function loadHomeData() {
    const [bookingRes, announcementRes, promoRes, memberRes] =
      await Promise.all([
        apiClient.get<Booking[]>("/api/bookings?upcoming=true&limit=1"),
        apiClient.get<Announcement[]>("/api/announcements?limit=20"),
        apiClient.get<Promotion[]>("/api/promotions?limit=2"),
        apiClient.get<MemberWithProfile[]>(
          "/api/members?limit=2&exclude_self=true&order=created_at"
        ),
      ]);

    setNextBooking(bookingRes.data?.[0] ?? null);
    setAnnouncements(announcementRes.data ?? []);
    setPromotions(promoRes.data ?? []);
    setNewMembers(memberRes.data ?? []);
    setLoading(false);
  }

  return (
    <AppShell>

      {/* Hero banner */}
      <div className="hero-banner relative">
        {/* Messages + notification bell — top right */}
        <div className="absolute top-3 right-4 flex items-center gap-0.5">
          <MessagesIcon />
          <NotificationBell variant="light" />
        </div>
        <p className="text-[10px] uppercase tracking-[0.16em] mb-2.5" style={{ color: 'rgba(255,255,255,0.32)' }}>
          {greeting}
        </p>
        <h1 className="font-sans font-black leading-tight mb-5" style={{ fontSize: '2.1rem', color: 'white' }}>
          Welcome back,{' '}
          <br />
          <em className="capitalize" style={{ color: 'var(--color-gold)', fontStyle: 'normal' }}>
            {firstName || "Guest"}.
          </em>
        </h1>

        {/* Next booking card */}
        {loading ? (
          <div className="rounded-2xl border p-4 animate-pulse h-[62px]"
            style={{ background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.07)' }} />
        ) : nextBooking ? (
          <Link
            href="/book"
            className="flex items-center gap-4 rounded-2xl p-4 border transition-all"
            style={{ background: 'rgba(255,255,255,0.07)', borderColor: 'rgba(133,187,101,0.22)' }}
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(133,187,101,0.15)', color: 'var(--color-gold)' }}>
              <Icon name="next-round" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-[0.12em] mb-1" style={{ color: 'rgba(255,255,255,0.32)' }}>
                Next round
              </p>
              <p className="text-sm font-medium" style={{ color: 'white' }}>
                {formatBookingDate(nextBooking.booking_date)} · {formatTeeTime(nextBooking.tee_time)}
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>
                Park Hyatt Aviara
                {nextBooking.guest_name ? ` · With ${nextBooking.guest_name}` : ""}
              </p>
            </div>
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"
              strokeWidth={1.5} style={{ color: 'rgba(133,187,101,0.5)' }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </Link>
        ) : (
          <Link
            href="/book"
            className="flex items-center gap-4 rounded-2xl p-4 border transition-all"
            style={{ background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.08)' }}
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.35)' }}>
              <Icon name="tee-time" />
            </div>
            <div>
              <p className="text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>No upcoming rounds</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-gold)' }}>Book a tee time →</p>
            </div>
          </Link>
        )}
      </div>

      <InstallBanner />

      {/* Content */}
      <div className="px-5 pt-6 space-y-7 pb-6">

        {/* Member Offers */}
        {(loading || promotions.length > 0) && (
          <section>
            <div className="flex items-center justify-between mb-3.5">
              <p className="section-label !mb-0">Member Offers</p>
              <Link href="/more/promotions" className="text-xs font-medium" style={{ color: 'var(--color-green-600)' }}>
                View all →
              </Link>
            </div>
            {loading ? (
              <div className="space-y-2.5">
                <CardSkeleton lines={2} />
                <CardSkeleton lines={2} />
              </div>
            ) : (
              <div className="space-y-2.5">
                {promotions.map((p) => <PromoCard key={p.id} promo={p} />)}
              </div>
            )}
          </section>
        )}

        {/* Who's Playing (Community Announcements) */}
        <section>
          <div className="flex items-center justify-between mb-3.5">
            <p className="section-label !mb-0">Announcements</p>
            <Link href="/more/announcements" className="text-xs font-medium" style={{ color: 'var(--color-green-600)' }}>
              See all →
            </Link>
          </div>
          {loading ? (
            <div className="space-y-2.5">
              <CardSkeleton lines={2} />
              <CardSkeleton lines={2} />
            </div>
          ) : announcements.length > 0 ? (() => {
              const pinned  = announcements.filter(a => a.is_pinned)
              const regular = announcements.filter(a => !a.is_pinned).slice(0, 3)
              return (
                <div className="space-y-2.5">
                  {pinned.length > 0 && <PinnedCarousel announcements={pinned} />}
                  {regular.map(a => <AnnouncementCard key={a.id} announcement={a} />)}
                </div>
              )
            })() : (
            <EmptyState compact icon="📢" title="No announcements yet" description="Course news and community highlights will appear here." />
          )}
        </section>

        {/* New Members */}
        {(loading || newMembers.length > 0) && (
          <section>
            <div className="flex items-center justify-between mb-3.5">
              <p className="section-label !mb-0">New Members</p>
              <Link href="/members" className="text-xs font-medium" style={{ color: 'var(--color-green-600)' }}>
                All members →
              </Link>
            </div>
            {loading ? (
              <div className="card">
                <MemberRowSkeleton />
                <MemberRowSkeleton />
              </div>
            ) : (
              <div className="card">
                {newMembers.map((m) => (
                  <Link
                    key={m.id}
                    href={`/members/${m.id}`}
                    className="member-row"
                  >
                    <Avatar
                      firstName={m.first_name}
                      lastName={m.last_name}
                      avatarUrl={m.profile?.avatar_url}
                      size="md"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium capitalize" style={{ color: 'var(--color-green-900)' }}>
                        {m.first_name} {m.last_name}
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: 'rgba(0,38,105,0.55)' }}>
                        {m.profile?.role_title ?? ""}
                        {m.profile?.business_name ? `, ${m.profile.business_name}` : ""}
                      </p>
                      {m.profile?.value_offered && (
                        <span className="tag mt-1.5">
                          Offers: {truncate(m.profile.value_offered, 40)}
                        </span>
                      )}
                    </div>
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"
                      strokeWidth={1.5} style={{ color: 'rgba(0,38,105,0.2)' }}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                  </Link>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </AppShell>
  );
}

// ---- Sub-components -----------------------------------------

function announcementFirstMedia(a: Announcement): { url: string; isVideo: boolean } | null {
  const url = a.media_urls?.[0] ?? a.image_url ?? a.video_url ?? null
  if (!url) return null
  const ext = url.split('?')[0]?.split('.').pop()?.toLowerCase() ?? ''
  return { url, isVideo: ['mp4', 'webm', 'mov', 'quicktime'].includes(ext) }
}

function AnnouncementThumbnail({ announcement }: { announcement: Announcement }) {
  const first = announcementFirstMedia(announcement)
  if (!first) return null
  const count = announcement.media_urls?.length
    ?? ((announcement.image_url ? 1 : 0) + (announcement.video_url ? 1 : 0))
  return (
    <div className="relative w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 bg-black">
      {first.isVideo ? (
        <video src={first.url} className="w-full h-full object-cover" muted playsInline />
      ) : (
        <Image src={first.url} alt="" fill className="object-cover" />
      )}
      {count > 1 && (
        <div className="absolute bottom-1 right-1 flex items-center gap-0.5 text-[9px] font-semibold text-white px-1.5 py-0.5 rounded-full leading-none"
          style={{ background: 'rgba(0,0,0,0.65)' }}>
          <StackIcon />
          {count}
        </div>
      )}
    </div>
  )
}

function StackIcon() {
  return (
    <svg className="w-2.5 h-2.5" viewBox="0 0 16 16" fill="currentColor">
      <rect x="3" y="6" width="10" height="8" rx="1.5" opacity="0.6" />
      <rect x="1" y="4" width="10" height="8" rx="1.5" opacity="0.4" />
      <rect x="5" y="2" width="10" height="8" rx="1.5" />
    </svg>
  )
}

const ANNOUNCEMENT_TYPES: Record<string, { icon: IconName; color: string; iconColor: string }> = {
  new_member:      { icon: 'new-member',       color: 'rgba(133,187,101,0.12)', iconColor: 'var(--color-green-700)' },
  booking:         { icon: 'tee-time',          color: 'rgba(0,38,105,0.07)',    iconColor: 'rgba(0,38,105,0.5)' },
  visiting_member: { icon: 'visiting-member',   color: 'rgba(26,85,173,0.08)',   iconColor: 'rgba(26,85,173,0.6)' },
  member_event:    { icon: 'next-round',        color: 'rgba(0,38,105,0.07)',    iconColor: 'rgba(0,38,105,0.5)' },
  admin_broadcast: { icon: 'announcement',      color: 'rgba(133,187,101,0.12)', iconColor: 'var(--color-green-700)' },
  focus_linkup:    { icon: 'focus-linkup',      color: 'rgba(0,38,105,0.07)',    iconColor: 'rgba(0,38,105,0.5)' },
}

function PinnedCarousel({ announcements }: { announcements: Announcement[] }) {
  const router = useRouter()
  const [current, setCurrent] = useState(0)
  const [timerKey, setTimerKey] = useState(0)
  const touchStartX = useRef<number | null>(null)
  const didSwipe = useRef(false)
  const multi = announcements.length > 1

  // Auto-advance every 7 s; resets whenever the user manually navigates
  useEffect(() => {
    if (!multi) return
    const id = setInterval(() => {
      setCurrent(c => (c + 1) % announcements.length)
    }, 7000)
    return () => clearInterval(id)
  }, [multi, announcements.length, timerKey])

  function navigate(idx: number) {
    setCurrent(idx)
    setTimerKey(k => k + 1) // restart the 7-s timer
  }

  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0]?.clientX ?? null
    didSwipe.current = false
  }

  function onTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null) return
    const delta = touchStartX.current - (e.changedTouches[0]?.clientX ?? touchStartX.current)
    if (Math.abs(delta) > 48) {
      didSwipe.current = true
      if (delta > 0) navigate(Math.min(current + 1, announcements.length - 1))
      else navigate(Math.max(current - 1, 0))
    }
    touchStartX.current = null
  }

  if (announcements.length === 0) return null

  return (
    <div className="relative" style={{ paddingBottom: multi ? 6 : 0 }}>
      {/* Single backdrop layer — only when multiple pinned */}
      {multi && (
        <div className="absolute inset-x-2 bottom-0 h-full rounded-2xl"
          style={{ background: 'rgba(200,160,40,0.12)', border: '1px solid rgba(200,160,40,0.20)', transform: 'translateY(4px) scaleX(0.96)' }} />
      )}

      {/* Main card */}
      <div
        role="button"
        tabIndex={0}
        className="card overflow-hidden relative cursor-pointer"
        style={{ zIndex: 2 }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onClick={() => {
          if (!didSwipe.current) {
            const ann = announcements[current]
            if (ann) router.push(`/more/announcements/${ann.id}`)
          }
        }}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            const ann = announcements[current]
            if (ann) router.push(`/more/announcements/${ann.id}`)
          }
          if (e.key === 'ArrowRight') navigate(Math.min(current + 1, announcements.length - 1))
          if (e.key === 'ArrowLeft') navigate(Math.max(current - 1, 0))
        }}
      >
        {/* Gold accent bar */}
        <div className="h-1" style={{ background: 'var(--color-gold)' }} />

        {/* Slide track */}
        <div
          className="flex"
          style={{ transform: `translateX(-${current * 100}%)`, transition: 'transform 400ms cubic-bezier(0.4,0,0.2,1)' }}
        >
          {announcements.map((ann) => {
            const m = ANNOUNCEMENT_TYPES[ann.type] ?? { icon: 'announcement' as IconName, color: 'rgba(0,38,105,0.07)', iconColor: 'rgba(0,38,105,0.5)' }
            return (
              <div key={ann.id} className="flex-shrink-0 w-full p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-gold)' }}>
                    📌 Pinned
                  </span>
                  {multi && (
                    <span className="text-[10px]" style={{ color: 'rgba(0,38,105,0.3)' }}>
                      {current + 1} / {announcements.length}
                    </span>
                  )}
                </div>
                <div className="flex gap-3 items-start">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: m.color, color: m.iconColor }}>
                    <Icon name={m.icon} className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold leading-snug line-clamp-2" style={{ color: 'var(--color-green-900)' }}>
                      {ann.title}
                    </p>
                    <p className="text-xs mt-1 leading-relaxed line-clamp-2" style={{ color: 'rgba(0,38,105,0.52)' }}>
                      {ann.body}
                    </p>
                    <p className="text-[10px] mt-1.5" style={{ color: 'rgba(0,38,105,0.3)' }}>
                      {formatRelativeTime(ann.published_at ?? ann.created_at)}
                    </p>
                  </div>
                  <AnnouncementThumbnail announcement={ann} />
                </div>
              </div>
            )
          })}
        </div>

        {/* Dot indicators */}
        {multi && (
          <div className="flex justify-center gap-1.5 pb-3 px-4">
            {announcements.map((_, i) => (
              <button
                key={i}
                onClick={e => { e.stopPropagation(); navigate(i) }}
                className="rounded-full"
                style={{
                  width: i === current ? 16 : 6,
                  height: 6,
                  background: i === current ? 'var(--color-gold)' : 'rgba(0,38,105,0.15)',
                  transition: 'width 250ms ease, background 250ms ease',
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function AnnouncementCard({ announcement }: { announcement: Announcement }) {
  const meta = ANNOUNCEMENT_TYPES[announcement.type] ?? { icon: 'announcement' as IconName, color: 'rgba(0,38,105,0.07)', iconColor: 'rgba(0,38,105,0.5)' }

  return (
    <Link href={`/more/announcements/${announcement.id}`} className="card p-4 flex gap-3 items-start overflow-hidden">
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{ background: meta.color, color: meta.iconColor }}
      >
        <Icon name={meta.icon} className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-snug line-clamp-2" style={{ color: 'var(--color-green-900)' }}>
          {announcement.title}
        </p>
        <p className="text-xs mt-1 leading-relaxed line-clamp-2" style={{ color: 'rgba(0,38,105,0.52)' }}>
          {announcement.body}
        </p>
        <p className="text-[10px] mt-1.5" style={{ color: 'rgba(0,38,105,0.3)' }}>
          {formatRelativeTime(announcement.published_at ?? announcement.created_at)}
        </p>
      </div>
      <AnnouncementThumbnail announcement={announcement} />
    </Link>
  )
}

function PromoCard({ promo }: { promo: Promotion }) {
  const mediaUrl = promo.media_urls?.[0] ?? promo.image_url ?? promo.video_url ?? null
  const mediaCount = promo.media_urls?.length ?? ((promo.image_url ? 1 : 0) + (promo.video_url ? 1 : 0))
  const isVideo = mediaUrl
    ? ['mp4', 'webm', 'mov', 'quicktime'].includes(mediaUrl.split('?')[0]?.split('.').pop()?.toLowerCase() ?? '')
    : false

  return (
    <Link href={`/more/promotions/${promo.id}`} className="card flex flex-col overflow-hidden">
      <div className="promo-accent" />
      <div className="p-4 flex gap-3 items-start">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0 mt-0.5"
          style={{ background: 'rgba(133,187,101,0.12)' }}
        >
          🎁
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-[0.12em] mb-0.5" style={{ color: 'var(--color-gold)' }}>
            {promo.badge_label}
          </p>
          <p className="text-sm font-medium leading-snug line-clamp-2" style={{ color: 'var(--color-green-900)' }}>
            {promo.title}
          </p>
          <p className="text-xs mt-1 leading-relaxed line-clamp-2" style={{ color: 'rgba(0,38,105,0.52)' }}>
            {promo.description}
          </p>
          {promo.expires_at && (
            <p className="text-[10px] mt-1.5" style={{ color: 'rgba(0,38,105,0.3)' }}>
              Expires {formatBookingDate(promo.expires_at)}
            </p>
          )}
        </div>
        {mediaUrl && (
          <div className="relative w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 bg-black">
            {isVideo ? (
              <video src={mediaUrl} className="w-full h-full object-cover" muted playsInline />
            ) : (
              <Image src={mediaUrl} alt="" fill className="object-cover" />
            )}
            {mediaCount > 1 && (
              <div className="absolute bottom-1 right-1 flex items-center gap-0.5 text-[9px] font-semibold text-white px-1.5 py-0.5 rounded-full leading-none"
                style={{ background: 'rgba(0,0,0,0.65)' }}>
                <StackIcon />
                {mediaCount}
              </div>
            )}
          </div>
        )}
      </div>
    </Link>
  )
}


function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}
