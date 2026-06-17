"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useProfile } from "@/hooks/useProfile";
import { apiClient } from "@/lib/api-client";
import { formatBookingDate, formatTeeTime, truncate, formatRelativeTime } from "@/lib/utils";
import Avatar from "@/components/ui/Avatar";
import EmptyState from "@/components/ui/EmptyState";
import AppShell from '@/components/layout/AppShell';
import InstallBanner from '@/components/ui/InstallBanner';
import Icon, { type IconName } from '@/components/ui/Icon';
import NotificationBell from '@/components/ui/NotificationBell';
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
        apiClient.get<Announcement[]>("/api/announcements?limit=3"),
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
        {/* Messages + notification bell — top right, mobile only */}
        <div className="absolute top-3 right-4 flex items-center gap-0.5 md:hidden">
          <Link href="/messages" className="relative flex items-center justify-center w-9 h-9 rounded-xl text-white/70 hover:text-white hover:bg-white/10 transition-colors" aria-label="Messages">
            <Icon name="messages" className="w-5 h-5" />
          </Link>
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

        {/* Community Announcements */}
        <section>
          <div className="flex items-center justify-between mb-3.5">
            <p className="section-label !mb-0">Community</p>
            <Link href="/more/announcements" className="text-xs font-medium" style={{ color: 'var(--color-green-600)' }}>
              See all →
            </Link>
          </div>
          {loading ? (
            <div className="space-y-2.5">
              <CardSkeleton lines={2} />
              <CardSkeleton lines={2} />
            </div>
          ) : announcements.length > 0 ? (
            <div className="space-y-2.5">
              {announcements.map((a) => (
                <AnnouncementCard key={a.id} announcement={a} />
              ))}
            </div>
          ) : (
            <EmptyState compact icon="📢" title="No announcements yet" description="Course news and community highlights will appear here." />
          )}
        </section>

        {/* Member Spotlight */}
        {(loading || newMembers.length > 0) && (
          <section>
            <div className="flex items-center justify-between mb-3.5">
              <p className="section-label !mb-0">Member Spotlight</p>
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

        {/* Promotions */}
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

function AnnouncementCard({ announcement }: { announcement: Announcement }) {
  const meta = ANNOUNCEMENT_TYPES[announcement.type] ?? { icon: 'announcement' as IconName, color: 'rgba(0,38,105,0.07)', iconColor: 'rgba(0,38,105,0.5)' }

  return (
    <Link href={`/more/announcements/${announcement.id}`} className="card p-4 flex gap-3 items-start">
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{ background: meta.color, color: meta.iconColor }}
      >
        <Icon name={meta.icon} className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p
          className="text-sm font-medium leading-snug line-clamp-2"
          style={{ color: 'var(--color-green-900)' }}
        >
          {announcement.title}
        </p>
        <p
          className="text-xs mt-1 leading-relaxed line-clamp-2"
          style={{ color: 'rgba(0,38,105,0.52)' }}
        >
          {announcement.body}
        </p>
        <p className="text-[10px] mt-1.5" style={{ color: 'rgba(0,38,105,0.3)' }}>
          {formatRelativeTime(announcement.published_at ?? announcement.created_at)}
        </p>
      </div>
      <AnnouncementThumbnail announcement={announcement} />
    </Link>
  );
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
