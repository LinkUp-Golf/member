"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuthStore } from "@/store/auth";
import { apiClient } from "@/lib/api-client";
import { formatBookingDate, formatTeeTime, truncate } from "@/lib/utils";
import Avatar from "@/components/ui/Avatar";
import AppShell from '@/components/layout/AppShell';
import { CardSkeleton, MemberRowSkeleton } from "@/components/ui/Loading";
import type {
  Booking,
  Announcement,
  Promotion,
  MemberWithProfile,
} from "@/types";

export default function HomePage() {
  const { user } = useAuthStore();
  const [nextBooking, setNextBooking] = useState<Booking | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [newMembers, setNewMembers] = useState<MemberWithProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const greeting = getGreeting();
  const firstName = user?.member?.first_name ?? "";

  useEffect(() => {
    if (!user) return;
    loadHomeData();
  }, [user]);

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
    <AppShell title="LinkUp Golf" description="Member Portal">

      {/* Hero banner */}
      <div className="hero-banner">
        <p className="text-xs uppercase tracking-widest text-white/40 mb-1">
          {greeting}
        </p>
        <h1 className="font-serif text-3xl text-white font-medium leading-tight">
          Welcome back,
          <br />
          <em className="text-gold">{firstName || "Guest"}.</em>
        </h1>

        {/* Next booking card */}
        {loading ? (
          <div className="mt-4 rounded-xl bg-white/5 p-4 animate-pulse h-16" />
        ) : nextBooking ? (
          <Link
            href="/book"
            className="block mt-4 rounded-xl bg-white/[0.06] border border-gold/20 p-3.5 flex items-center gap-3"
          >
            <div className="w-10 h-10 rounded-lg bg-gold/15 flex items-center justify-center text-gold text-xl flex-shrink-0">
              ⛳
            </div>
            <div>
              <p className="text-xs text-white/40 uppercase tracking-wider mb-0.5">
                Your next round
              </p>
              <p className="text-sm text-white font-medium">
                {formatBookingDate(nextBooking.booking_date)} ·{" "}
                {formatTeeTime(nextBooking.tee_time)}
              </p>
              <p className="text-xs text-white/40 mt-0.5">
                Park Hyatt Aviara
                {nextBooking.guest_name
                  ? ` · With ${nextBooking.guest_name}`
                  : ""}
              </p>
            </div>
          </Link>
        ) : (
          <Link
            href="/book"
            className="block mt-4 rounded-xl bg-white/[0.06] border border-white/10 p-3.5 flex items-center gap-3"
          >
            <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center text-white/40 text-xl flex-shrink-0">
              📅
            </div>
            <div>
              <p className="text-sm text-white/60">No upcoming rounds</p>
              <p className="text-xs text-gold mt-0.5">Book a tee time →</p>
            </div>
          </Link>
        )}
      </div>

      {/* Content */}
      <div className="px-5 pt-5 space-y-6 pb-6">
        {/* Community Announcements */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <p className="section-label">Community</p>
            <Link href="/more/announcements" className="text-xs text-green-600">
              See all →
            </Link>
          </div>
          {loading ? (
            <div className="space-y-2">
              <CardSkeleton lines={2} />
              <CardSkeleton lines={2} />
            </div>
          ) : announcements.length > 0 ? (
            <div className="space-y-2">
              {announcements.map((a) => (
                <AnnouncementCard key={a.id} announcement={a} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-green-900/40 italic">
              No announcements yet.
            </p>
          )}
        </section>

        {/* Member Spotlight */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <p className="section-label">Member Spotlight</p>
            <Link href="/members" className="text-xs text-green-600">
              All members →
            </Link>
          </div>
          {loading ? (
            <div className="card">
              <MemberRowSkeleton />
              <MemberRowSkeleton />
            </div>
          ) : newMembers.length > 0 ? (
            <div className="card">
              {newMembers.map((m) => (
                <Link
                  key={m.id}
                  href={`/members/${m.id}`}
                  className="member-row block"
                >
                  <div className="flex items-center gap-3">
                    <Avatar
                      firstName={m.first_name}
                      lastName={m.last_name}
                      avatarUrl={m.profile?.avatar_url}
                      size="md"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-green-900">
                        {m.first_name} {m.last_name}
                      </p>
                      <p className="text-xs text-green-900/60 mt-0.5">
                        {m.profile?.role_title ?? ""}
                        {m.profile?.business_name
                          ? `, ${m.profile.business_name}`
                          : ""}
                      </p>
                      {m.profile?.value_offered && (
                        <span className="tag mt-1 text-xs">
                          Offers: {truncate(m.profile.value_offered, 40)}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-sm text-green-900/40 italic">
              No members to spotlight yet.
            </p>
          )}
        </section>

        {/* Promotions */}
        {(loading || promotions.length > 0) && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <p className="section-label">Member Offers</p>
              <Link href="/more/promotions" className="text-xs text-green-600">
                View all →
              </Link>
            </div>
            {loading ? (
              <div className="promo-card p-4">
                <CardSkeleton lines={3} />
              </div>
            ) : (
              promotions.map((p) => <PromoCard key={p.id} promo={p} />)
            )}
          </section>
        )}
      </div>
    </AppShell>
  );
}

// ---- Sub-components -----------------------------------------

function AnnouncementCard({ announcement }: { announcement: Announcement }) {
  const icons: Record<string, string> = {
    new_member: "👋",
    booking: "⛳",
    visiting_member: "✈️",
    member_event: "📅",
    admin_broadcast: "📢",
    focus_linkup: "🎯",
  };

  return (
    <div className="card card-pad flex gap-3 items-start">
      <span className="text-xl mt-0.5 flex-shrink-0">
        {icons[announcement.type] ?? "📌"}
      </span>
      <div>
        <p className="text-sm font-medium text-green-900">
          {announcement.title}
        </p>
        <p className="text-xs text-green-900/60 mt-1 leading-relaxed">
          {truncate(announcement.body, 120)}
        </p>
      </div>
    </div>
  );
}

function PromoCard({ promo }: { promo: Promotion }) {
  return (
    <div className="promo-card mb-3">
      <div className="promo-accent" />
      <div className="p-4">
        <p
          className="text-xs uppercase tracking-widest mb-2"
          style={{ color: "#85bb65" }}
        >
          {promo.badge_label}
        </p>
        <p className="font-serif text-lg text-white font-medium leading-snug">
          {promo.title}
        </p>
        <p className="text-xs text-white/50 mt-2 leading-relaxed">
          {truncate(promo.description, 120)}
        </p>
        {promo.expires_at && (
          <p className="text-xs text-white/30 mt-2">
            Expires {formatBookingDate(promo.expires_at)}
          </p>
        )}
        {promo.cta_url && (
          <a
            href={promo.cta_url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-gold btn-sm mt-3 inline-flex"
          >
            {promo.cta_label}
          </a>
        )}
      </div>
    </div>
  );
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}
