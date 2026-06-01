"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/auth";
import { apiClient } from "@/lib/api-client";
import AppShell from "@/components/layout/AppShell";
import { PromoCardSkeleton } from "@/components/ui/Loading";
import { formatBookingDate } from "@/lib/utils";
import type { Promotion } from "@/types";

export default function PromotionsPage() {
  const { user } = useAuthStore();
  const router = useRouter();
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) loadPromotions();
  }, [user]);

  async function loadPromotions() {
    const response = await apiClient.get<Promotion[]>("/api/promotions");
    setPromotions(response.data ?? []);
    setLoading(false);
  }

  return (
    <AppShell
      header={
        <div className="top-bar flex items-center gap-3">
          <div className="flex-1">
            <div className="logo-text">Member Offers</div>
            <div className="logo-subtitle">Curated · Exclusive</div>
          </div>
        </div>
      }
    >
      <div className="px-5 py-4 pb-8">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <PromoCardSkeleton key={i} />
            ))}
          </div>
        ) : promotions.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-3xl mb-3">🎁</p>
            <p className="font-sans font-black text-xl text-green-900 mb-2">
              No offers right now
            </p>
            <p className="text-sm text-green-900/45">
              Check back soon — new member offers are added regularly.
            </p>
          </div>
        ) : (
          promotions.map((p) => <PromoCard key={p.id} promo={p} onTap={() => router.push(`/more/promotions/${p.id}`)} />)
        )}
      </div>
    </AppShell>
  );
}

function PromoCard({ promo, onTap }: { promo: Promotion; onTap?: () => void }) {
  return (
    <div className="promo-card mb-4 cursor-pointer" onClick={onTap} onKeyDown={e => e.key === 'Enter' && onTap?.()} role="button" tabIndex={0}>
      <div className="promo-accent" />
      {(() => {
        const url = promo.media_urls?.[0] ?? promo.image_url ?? promo.video_url
        if (!url) return null
        const ext = url.split('?')[0]?.split('.').pop()?.toLowerCase() ?? ''
        const isVideo = ['mp4', 'webm', 'mov', 'quicktime'].includes(ext)
        return isVideo
          ? <video src={url} muted playsInline className="w-full max-h-56 object-contain bg-black rounded-t-2xl" />
          : <img src={url} alt="" className="w-full max-h-56 object-contain bg-black rounded-t-2xl" />
      })()}
      <div className="p-5">
        <p
          className="text-xs uppercase tracking-widest mb-2"
          style={{ color: "#85bb65" }}
        >
          {promo.badge_label}
        </p>
        <p className="font-sans font-black text-xl text-white leading-snug mb-2">
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
  );
}

