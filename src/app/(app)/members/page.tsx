"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAuthStore } from "@/store/auth";
import { apiClient } from "@/lib/api-client";
import { shortCategory, truncate, capitalizeName } from "@/lib/utils";
import Avatar from "@/components/ui/Avatar";
import AppShell from "@/components/layout/AppShell";
import { MemberRowSkeleton } from "@/components/ui/Loading";
import { INDUSTRY_CATEGORIES } from "@/types";
import type { MemberWithProfile } from "@/types";

const FILTER_ALL = "All";

export default function MembersPage() {
  const { user, initialized } = useAuthStore();
  const [members, setMembers] = useState<MemberWithProfile[]>([]);
  const [filtered, setFiltered] = useState<MemberWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState(FILTER_ALL);

  const filters = [FILTER_ALL, ...INDUSTRY_CATEGORIES.map(shortCategory)];

  useEffect(() => {
    if (!initialized) return;
    if (user) {
      loadMembers();
    } else {
      setLoading(false);
    }
  }, [user, initialized]);

  const applyFilters = useCallback(() => {
    let result = members;

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (m) =>
          `${m.first_name} ${m.last_name}`.toLowerCase().includes(q) ||
          m.profile?.business_name?.toLowerCase().includes(q) ||
          m.profile?.role_title?.toLowerCase().includes(q) ||
          m.profile?.value_offered?.toLowerCase().includes(q) ||
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

  async function loadMembers() {
    const response = await apiClient.get<MemberWithProfile[]>("/api/members");
    if (!response.error && response.data) {
      setMembers(response.data);
      setFiltered(response.data);
    }
    setLoading(false);
  }

  return (
    <AppShell title="Members" description={`${members.length} active members`}>
      {/* Search */}
      <div className="px-5 pt-4">
        <div
          className="flex items-center gap-2.5 bg-white rounded-xl px-4 py-3 border"
          style={{
            borderColor: "rgba(0,38,105,0.1)",
            boxShadow: "0 1px 3px rgba(0,38,105,0.05)",
          }}
        >
          <SearchIcon />
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
              className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0 transition-colors"
              style={{
                color: "rgba(0,38,105,0.4)",
                background: "rgba(0,38,105,0.06)",
              }}
            >
              ×
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
        <div className="px-5 py-14 text-center">
          <p
            className="text-sm italic"
            style={{ color: "rgba(0,38,105,0.35)" }}
          >
            {search ? "No members match your search." : "No members found."}
          </p>
        </div>
      ) : (
        <div className="mx-5 card mb-6">
          {filtered.map((m) => (
            <MemberRow key={m.id} member={m} currentUserId={user?.id} />
          ))}
        </div>
      )}
    </AppShell>
  );
}

// ---- Member row component -----------------------------------

function MemberRow({
  member: m,
  currentUserId,
}: {
  member: MemberWithProfile;
  currentUserId?: string;
}) {
  const isMe = m.id === currentUserId;

  return (
    <Link
      href={isMe ? "/more/profile" : `/members/${m.id}`}
      className="member-row"
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
            className="text-sm font-medium"
            style={{ color: "var(--color-green-900)" }}
          >
            {capitalizeName(m.first_name)} {capitalizeName(m.last_name)}
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
        {m.profile?.value_offered && (
          <span className="tag mt-1.5">
            Offers: {truncate(m.profile.value_offered, 45)}
          </span>
        )}
      </div>
      <svg
        className="w-4 h-4 flex-shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
        style={{ color: "rgba(0,38,105,0.2)" }}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M8.25 4.5l7.5 7.5-7.5 7.5"
        />
      </svg>
    </Link>
  );
}

// ---- Icons --------------------------------------------------

function SearchIcon() {
  return (
    <svg
      className="w-4 h-4 flex-shrink-0"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
      style={{ color: "rgba(0,38,105,0.32)" }}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
      />
    </svg>
  );
}
