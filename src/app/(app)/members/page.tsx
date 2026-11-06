"use client";

import { useState, useEffect, useCallback, useMemo, memo } from "react";
import Link from "next/link";
import { Search, X, ChevronRight, Users } from "lucide-react";
import { useProfile } from "@/hooks/useProfile";
import { apiClient } from "@/lib/api-client";
import { shortCategory } from "@/lib/utils";
import Avatar from "@/components/ui/Avatar";
import AppShell from "@/components/layout/AppShell";
import { MemberRowSkeleton } from "@/components/ui/Loading";
import EmptyState from "@/components/ui/EmptyState";
import RecommendedPartners from "@/components/matching/RecommendedPartners";
import SuggestedTag from "@/components/matching/SuggestedTag";
import { useRecommendations, type Recommendation } from "@/hooks/useRecommendations";
import { INDUSTRY_CATEGORIES } from "@/types";
import type { MemberWithProfile } from "@/types";

const FILTER_ALL = "All";

export default function MembersPage() {
  const { user, loading: authLoading } = useProfile();
  const [members, setMembers] = useState<MemberWithProfile[]>([]);
  const [filtered, setFiltered] = useState<MemberWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState(FILTER_ALL);

  const filters = useMemo(() => [FILTER_ALL, ...INDUSTRY_CATEGORIES.map(shortCategory)], []);
  const { recommendations } = useRecommendations();
  const suggestedById = useMemo(
    () => new Map(recommendations.map((r) => [r.member.id, r])),
    [recommendations],
  );

  const loadMembers = useCallback(async () => {
    const response = await apiClient.get<MemberWithProfile[]>("/api/members");
    if (!response.error && response.data) {
      setMembers(response.data);
      setFiltered(response.data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (user) {
      loadMembers();
    } else {
      setLoading(false);
    }
  }, [user, authLoading, loadMembers]);

  const applyFilters = useCallback(() => {
    let result = members;

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (m) =>
          `${m.first_name} ${m.last_name}`.toLowerCase().includes(q) ||
          m.profile?.business_name?.toLowerCase().includes(q) ||
          m.profile?.role_title?.toLowerCase().includes(q) ||
          m.profile?.value_sought?.toLowerCase().includes(q) ||
          m.profile?.industry_category?.toLowerCase().includes(q),
      );
    }

    if (activeFilter !== FILTER_ALL) {
      result = result.filter(
        (m) =>
          m.profile?.industry_category &&
          shortCategory(m.profile.industry_category) === activeFilter,
      );
    }

    setFiltered(result);
  }, [search, activeFilter, members]);

  useEffect(() => {
    applyFilters();
  }, [applyFilters]);

  return (
    <AppShell title="Members" description={`${members.length} active members`}>
      <div className="max-w-6xl mx-auto w-full">
      {/* Playing partners an admin picked for this member — nothing when none. */}
      {/* Hidden, not unmounted, while searching: remounting would re-fetch. */}
      <div className={`px-5 pt-4 empty:hidden ${search || activeFilter !== FILTER_ALL ? "hidden" : ""}`}>
        <RecommendedPartners variant="members" />
      </div>

      {/* Search */}
      <div className="px-5 pt-4">
        <div className="flex items-center gap-2.5 bg-white rounded-xl px-4 py-3 border shadow-card transition-shadow focus-within:shadow-raised"
          style={{ borderColor: "rgba(0,38,105,0.1)" }}
        >
          <Search className="w-4 h-4 flex-shrink-0" style={{ color: "rgba(0,38,105,0.32)" }} strokeWidth={2} />
          <input
            type="search"
            placeholder="Search by name, industry, goals…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-sm outline-none"
            style={{ color: "var(--color-green-900)" }}
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="focus-ring w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 transition-colors"
              style={{
                color: "rgba(0,38,105,0.4)",
                background: "rgba(0,38,105,0.06)",
              }}
              aria-label="Clear search"
            >
              <X className="w-3 h-3" strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex gap-2 py-3.5 overflow-x-auto hide-scrollbar mx-5">
        {filters.map((f) => (
          <button
            key={f}
            onClick={() => setActiveFilter(f)}
            className={`chip ${activeFilter === f ? "active" : ""}`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Results count */}
      {!loading && search && (
        <p
          className="px-5 pb-2 text-xs"
          style={{ color: "rgba(0,38,105,0.38)" }}
        >
          {filtered.length} result{filtered.length !== 1 ? "s" : ""}
        </p>
      )}

      {/* Member list */}
      {loading ? (
        <div className="mx-5 card">
          {Array.from({ length: 6 }).map((_, i) => (
            <MemberRowSkeleton key={i} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="px-5 py-6">
          <EmptyState
            icon={search ? <Search className="w-5 h-5" strokeWidth={1.75} /> : <Users className="w-5 h-5" strokeWidth={1.75} />}
            title={search ? "No members match your search" : "No members yet"}
            description={search ? "Try a different name or keyword." : "Members will appear here once they join."}
          />
        </div>
      ) : (
        <div className="mx-5 card mb-6">
          {filtered.map((m) => (
            <MemberRow key={m.id} member={m} currentUserId={user?.id} suggestion={suggestedById.get(m.id)} />
          ))}
        </div>
      )}
      </div>
    </AppShell>
  );
}

// ---- Member row component -----------------------------------

const MemberRow = memo(function MemberRow({
  member: m,
  currentUserId,
  suggestion,
}: {
  member: MemberWithProfile;
  currentUserId?: string;
  /** Set when the LinkUp team recommended this member to the viewer. */
  suggestion?: Recommendation;
}) {
  const isMe = m.id === currentUserId;

  // The tag is a button, so it sits beside the link rather than inside it;
  // the wrapper draws the divider .member-row would otherwise lose.
  return (
    <div className="relative border-b-[0.5px] border-[rgba(0,38,105,0.06)] last:border-b-0">
    <Link
      href={isMe ? "/more/profile" : `/members/${m.id}`}
      className={`member-row focus-ring !border-b-0 ${suggestion ? "pr-32" : ""}`}
    >
      <Avatar
        firstName={m.first_name}
        lastName={m.last_name}
        avatarUrl={m.profile?.avatar_url}
        size="md"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <p
            className="text-sm font-medium capitalize"
            style={{ color: "var(--color-green-900)" }}
          >
            {m.first_name} {m.last_name}
          </p>
          {isMe && (
            <span
              className="text-[10px] font-medium px-2 py-0.5 rounded-full"
              style={{
                color: "var(--color-gold-dark)",
                background: "rgba(133,187,101,0.12)",
              }}
            >
              You
            </span>
          )}
        </div>
        <p className="text-xs truncate" style={{ color: "rgba(0,38,105,0.5)" }}>
          {[m.profile?.role_title, m.profile?.business_name]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <ChevronRight
        className={`w-4 h-4 flex-shrink-0 ${suggestion ? "absolute right-5 top-1/2 -translate-y-1/2" : ""}`}
        style={{ color: "rgba(0,38,105,0.2)" }}
        strokeWidth={1.75}
      />
    </Link>
    {suggestion && (
      <div className="absolute right-11 top-1/2 -translate-y-1/2">
        <SuggestedTag recommendation={suggestion} />
      </div>
    )}
    </div>
  );
});
