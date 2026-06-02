"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useProfile } from "@/hooks/useProfile"
import { apiClient } from "@/lib/api-client";
import { capitalizeName } from "@/lib/utils";
import Avatar from "@/components/ui/Avatar";
import { Spinner } from "@/components/ui/Loading";
import AppShell from "@/components/layout/AppShell";
import type { MemberWithProfile } from "@/types";

export default function MemberProfilePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useProfile();
  const [member, setMember] = useState<MemberWithProfile | null>(null);
  const [playedTogether, setPlayedTogether] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadMember = useCallback(async () => {
    const response = await apiClient.get<{
      member: MemberWithProfile;
      hasPlayedWith: boolean;
    }>(`/api/members/${id}`);

    if (response.error || !response.data) {
      router.push("/members");
      return;
    }

    setMember(response.data.member);
    setPlayedTogether(response.data.hasPlayedWith);
    setLoading(false);
  }, [id, router]);

  useEffect(() => {
    if (id) loadMember();
  }, [id, loadMember]);

  const [startingConv, setStartingConv] = useState(false);

  async function startConversation() {
    if (!user || !member || startingConv) return;
    setStartingConv(true);

    const res = await apiClient.post<{ id: string }>("/api/conversations", {
      type: "direct",
      participant_ids: [member.id],
    });

    setStartingConv(false);
    if (res.data?.id) router.push(`/messages/${res.data.id}`);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner className="text-green-700" />
      </div>
    );
  }

  if (!member) return null;

  const p = member.profile;

  return (
    <AppShell
      title={`${capitalizeName(member.first_name)} ${capitalizeName(member.last_name)}`}
      description={p?.role_title ?? "Member"}
    >
      {/* Profile header */}
      <div className="bg-green-900 px-5 py-12 text-center">
        <div className="flex justify-center mb-3">
          <Avatar
            firstName={member.first_name}
            lastName={member.last_name}
            avatarUrl={p?.avatar_url}
            size="xl"
          />
        </div>
        <h1 className="font-sans font-black text-2xl text-white">
          {capitalizeName(member.first_name)} {capitalizeName(member.last_name)}
        </h1>
        {p?.role_title && (
          <p className="text-sm text-white/50 mt-1">
            {p.role_title}
            {p.business_name ? ` · ${p.business_name}` : ""}
          </p>
        )}

        {/* Tags */}
        <div className="flex gap-2 justify-center flex-wrap mt-3">
          {p?.industry_category && (
            <span className="profile-tag">{p.industry_category}</span>
          )}
          {member.home_course?.city && (
            <span className="profile-tag">{member.home_course.city}</span>
          )}
          {p?.handicap_index !== null &&
            p?.handicap_index !== undefined &&
            p?.show_handicap && (
              <span className="profile-tag">HCP {p.handicap_index}</span>
            )}
          {playedTogether && (
            <span className="profile-tag">⛳ Played together</span>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="px-5 py-4 flex gap-3">
        <button
          onClick={startConversation}
          disabled={startingConv}
          className="btn btn-primary flex-1 justify-center disabled:opacity-60"
        >
          {startingConv ? (
            <Spinner className="w-4 h-4 text-gold" />
          ) : (
            <MessageIcon />
          )}
          Message
        </button>
        <Link
          href={`/book?invite=${member.id}`}
          className="btn btn-outline flex-1 justify-center"
        >
          <CalendarIcon /> Invite to round
        </Link>
      </div>

      {/* Play suggestion */}
      {!playedTogether && (
        <div className="mx-5 mb-4 rounded-xl bg-green-50 border border-green-900/10 p-3.5 flex items-start gap-3">
          <span className="text-lg">💡</span>
          <div>
            <p className="text-sm text-green-900 font-medium">
              You haven&apos;t played with {capitalizeName(member.first_name)}{" "}
              yet
            </p>
            <p className="text-xs text-green-900/55 mt-0.5">
              Would you like us to find a date? Start a message to coordinate.
            </p>
          </div>
        </div>
      )}

      {/* Profile sections */}
      <div className="pb-6">

        {/* Professional background */}
        <div className="px-5 py-4 border-b border-green-900/08">
          <p className="text-xs uppercase tracking-widest text-green-900/40 mb-3">Professional background</p>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-medium text-green-900/50">Industry</span>
            {p?.industry_category
              ? <span className="text-xs bg-green-50 text-green-900 px-2.5 py-0.5 rounded-full border border-green-900/10">{p.industry_category}</span>
              : <span className="text-xs text-green-900/25 italic">Not specified</span>
            }
          </div>
          <p className="text-sm text-green-900 leading-relaxed mt-2">
            {p?.business_description ?? <span className="text-green-900/25 italic">No description yet</span>}
          </p>
        </div>

        {/* Networking */}
        <div className="px-5 py-4 border-b border-green-900/08">
          <p className="text-xs uppercase tracking-widest text-green-900/40 mb-3">Networking</p>
          <div className="mb-3">
            <p className="text-xs text-green-900/50 mb-1">What they bring</p>
            <p className="text-sm text-green-900 leading-relaxed">
              {p?.value_offered ?? <span className="text-green-900/25 italic">Not filled in</span>}
            </p>
          </div>
          <div>
            <p className="text-xs text-green-900/50 mb-1">What they&apos;re looking for</p>
            <p className="text-sm text-green-900 leading-relaxed">
              {p?.value_sought ?? <span className="text-green-900/25 italic">Not filled in</span>}
            </p>
          </div>
        </div>

        {/* Golf details */}
        <div className="px-5 py-4 border-b border-green-900/08">
          <p className="text-xs uppercase tracking-widest text-green-900/40 mb-3">Golf details</p>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <GolfStat
              value={p?.handicap_index !== null && p?.handicap_index !== undefined && p?.show_handicap ? String(p.handicap_index) : '—'}
              label="Handicap"
            />
            <GolfStat value={p?.play_frequency ?? '—'} label="Rounds / month" />
            <GolfStat value={p?.preferred_play_times ?? '—'} label="Preferred time" />
            <GolfStat value={p?.open_to_golf_travel ? 'Yes' : 'No'} label="Golf travel" />
          </div>
          <p className="text-sm text-green-900/60 leading-relaxed">
            {p?.family_golfers ?? <span className="text-green-900/25 italic">No additional info</span>}
          </p>
        </div>

        {/* Personal */}
        <div className="px-5 py-4 border-b border-green-900/08">
          <p className="text-xs uppercase tracking-widest text-green-900/40 mb-2">Beyond the office</p>
          <p className="text-sm text-green-900 leading-relaxed">
            {p?.non_golf_hobbies ?? <span className="text-green-900/25 italic">Not filled in</span>}
          </p>
        </div>

      </div>
    </AppShell>
  );
}

// ---- Sub-components -----------------------------------------


function GolfStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="bg-green-50 rounded-xl p-3 text-center">
      <p className="font-sans font-black text-xl text-green-900">{value}</p>
      <p className="text-xs text-green-900/40 mt-1 tracking-wide">{label}</p>
    </div>
  );
}

// ---- Inline icons -------------------------------------------
function MessageIcon() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"
      />
    </svg>
  );
}
function CalendarIcon() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5m-9-6h.008v.008H12v-.008zM12 15h.008v.008H12V15zm0 2.25h.008v.008H12v-.008zM9.75 15h.008v.008H9.75V15zm0 2.25h.008v.008H9.75v-.008zM7.5 15h.008v.008H7.5V15zm0 2.25h.008v.008H7.5v-.008zm6.75-4.5h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V15zm0 2.25h.008v.008h-.008v-.008zm2.25-4.5h.008v.008H16.5v-.008zm0 2.25h.008v.008H16.5V15z"
      />
    </svg>
  );
}
