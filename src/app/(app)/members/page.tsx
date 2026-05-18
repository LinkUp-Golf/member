"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAuthStore } from "@/store/auth";
import { createClient } from "@/lib/supabase";
import { shortCategory, truncate } from "@/lib/utils";
import { ALL_ACCESS_TAGS } from "@/lib/ghl-tags";
import Avatar from "@/components/ui/Avatar";
import TopBar from "@/components/ui/TopBar";
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

  useEffect(() => {
    applyFilters();
  }, [search, activeFilter, members]);

  async function loadMembers() {
    const supabase = createClient();
    const courseId = user?.member?.home_course_id;
    if (!courseId) {
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("members")
      .select("*, profile:member_profiles(*), home_course:courses(*)")
      .eq("home_course_id", courseId)
      .eq("membership_status", "active")
      .contains("ghl_tags", ALL_ACCESS_TAGS)
      .order("first_name", { ascending: true });

    if (!error && data) {
      setMembers(data as MemberWithProfile[]);
      setFiltered(data as MemberWithProfile[]);
    }
    setLoading(false);
  }

  const applyFilters = useCallback(() => {
    let result = members;

    // Search filter
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

    // Category filter
    if (activeFilter !== FILTER_ALL) {
      result = result.filter(
        (m) =>
          m.profile?.industry_category &&
          shortCategory(m.profile.industry_category) === activeFilter,
      );
    }

    setFiltered(result);
  }, [search, activeFilter, members]);

  return (
    <div>
      <TopBar
        title="Members"
        subtitle={loading ? "" : `${members.length} active members`}
      />

      {/* Search */}
      <div className="px-5 pt-4">
        <div className="flex items-center gap-2 bg-green-50 border border-green-900/10 rounded-xl px-3.5 py-2.5">
          <SearchIcon />
          <input
            type="search"
            placeholder="Search by name, industry, goals…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-sm text-green-900 placeholder-green-900/35 outline-none"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="text-green-900/30 text-lg leading-none"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex gap-2 px-5 py-3 overflow-x-auto hide-scrollbar">
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
        <p className="px-5 pb-2 text-xs text-green-900/40">
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
        <div className="px-5 py-12 text-center">
          <p className="text-green-900/40 text-sm italic">
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
    </div>
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
      className="member-row flex items-center gap-3"
    >
      <Avatar
        firstName={m.first_name}
        lastName={m.last_name}
        avatarUrl={m.profile?.avatar_url}
        size="md"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-green-900">
            {m.first_name} {m.last_name}
          </p>
          {isMe && (
            <span className="text-xs text-gold bg-green-900/10 px-2 py-0.5 rounded-full">
              You
            </span>
          )}
        </div>
        <p className="text-xs text-green-900/55 mt-0.5 truncate">
          {[m.profile?.role_title, m.profile?.business_name]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {m.profile?.value_offered && (
          <span className="tag mt-1.5 text-xs">
            Offers: {truncate(m.profile.value_offered, 45)}
          </span>
        )}
      </div>
      <ChevronRight />
    </Link>
  );
}

// ---- Icons --------------------------------------------------

function SearchIcon() {
  return (
    <svg
      className="w-4 h-4 text-green-900/35 flex-shrink-0"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
      />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg
      className="w-4 h-4 text-green-900/25 flex-shrink-0"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8.25 4.5l7.5 7.5-7.5 7.5"
      />
    </svg>
  );
}
