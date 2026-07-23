"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { MessageCircle, CalendarPlus, Flag, Lightbulb } from "lucide-react";
import { useProfile } from "@/hooks/useProfile"
import { apiClient } from "@/lib/api-client";
import Avatar from "@/components/ui/Avatar";
import { Spinner } from "@/components/ui/Loading";
import AppShell from "@/components/layout/AppShell";
import { RateLimitBanner } from "@/components/ui/RateLimitModal";
import type { MemberWithProfile, HostedEvent } from "@/types";

export default function MemberProfilePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useProfile();
  const [member, setMember] = useState<MemberWithProfile | null>(null);
  const [playedTogether, setPlayedTogether] = useState(false);
  const [focusGroups, setFocusGroups] = useState<string[]>([]);
  const [hostedEvents, setHostedEvents] = useState<HostedEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const loadMember = useCallback(async () => {
    const response = await apiClient.get<{
      member: MemberWithProfile;
      hasPlayedWith: boolean;
      focusLinkupGroups: string[];
    }>(`/api/members/${id}`);

    if (response.error || !response.data) {
      router.push("/members");
      return;
    }

    setMember(response.data.member);
    setPlayedTogether(response.data.hasPlayedWith);
    setFocusGroups(response.data.focusLinkupGroups ?? []);
    setLoading(false);
  }, [id, router]);

  useEffect(() => {
    if (id) loadMember();
  }, [id, loadMember]);

  // Events this member is hosting (if they're a host) — surfaced so others can
  // discover and reserve a spot from the profile.
  useEffect(() => {
    if (!id) return;
    fetch(`/api/hosted-events?host_member_id=${id}`)
      .then(r => r.json())
      .then(j => setHostedEvents(Array.isArray(j.events) ? j.events : []))
      .catch(() => {});
  }, [id]);

  const [startingConv, setStartingConv] = useState(false);
  const [blocked, setBlocked] = useState<{ title: string; message: string } | null>(null);

  async function startConversation() {
    if (!user || !member || startingConv) return;
    setStartingConv(true);

    const res = await apiClient.post<{ id: string }>("/api/conversations", {
      type: "direct",
      participant_ids: [member.id],
    });

    setStartingConv(false);

    if (res.status === 403) {
      setBlocked({ title: "Messaging Restricted", message: "The app anti-spam setting limits users to messaging and invite thresholds. You have exceeded this threshhold. You will be able to message and invite again in 3 hours." });
      return;
    }
    if (res.status === 429) {
      setBlocked({ title: "Limit Reached", message: res.error?.message ?? "Too many invitations. Please try again later." });
      return;
    }
    if (res.error || !res.data) {
      setBlocked({ title: "Couldn't Start Conversation", message: res.error?.message ?? "Something went wrong. Please try again." });
      return;
    }

    router.push(`/messages/${res.data.id}`);
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
      title={`${member.first_name} ${member.last_name}`}
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
        <h1 className="font-sans font-black text-2xl text-white capitalize">
          {member.first_name} {member.last_name}
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
          {playedTogether && (
            <span className="profile-tag flex items-center gap-1">
              <Flag className="w-3 h-3" strokeWidth={2.25} fill="currentColor" />
              Played together
            </span>
          )}
        </div>
      </div>

      {blocked && (
        <div className="px-5 pt-4">
          <RateLimitBanner title={blocked.title} message={blocked.message} onClose={() => setBlocked(null)} />
        </div>
      )}

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
            <MessageCircle className="w-4 h-4" strokeWidth={1.9} />
          )}
          Message
        </button>
        <Link
          href={`/book?invite=${member.id}`}
          className="btn btn-outline flex-1 justify-center"
        >
          <CalendarPlus className="w-4 h-4" strokeWidth={1.9} /> Invite to round
        </Link>
      </div>

      {/* Play suggestion */}
      {!playedTogether && (
        <div className="mx-5 mb-4 rounded-xl bg-green-50 border border-green-900/10 p-3.5 flex items-start gap-3">
          <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(133,187,101,0.15)', color: 'var(--color-green-700)' }}>
            <Lightbulb className="w-4 h-4" strokeWidth={1.9} />
          </div>
          <div>
            <p className="text-sm text-green-900 font-medium">
              You haven&apos;t played with <span className="capitalize">{member.first_name}</span>{" "}
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

        {/* Professional profile */}
        <div className="px-5 py-4 border-b border-green-900/08">
          <p className="text-xs uppercase tracking-widest text-green-900/40 mb-3">Professional profile</p>
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
          {p?.linkedin_url && (
            <a
              href={p.linkedin_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 mt-3 text-xs text-green-700 hover:text-green-900"
            >
              <LinkedInIcon /> LinkedIn profile
            </a>
          )}
        </div>

        {/* Community */}
        <div className="px-5 py-4 border-b border-green-900/08">
          <p className="text-xs uppercase tracking-widest text-green-900/40 mb-3">Community</p>
          <div className="mb-3">
            <p className="text-xs text-green-900/50 mb-1">What I bring</p>
            <p className="text-sm text-green-900 leading-relaxed">
              {p?.value_offered ?? <span className="text-green-900/25 italic">Not filled in</span>}
            </p>
          </div>
          <div>
            <p className="text-xs text-green-900/50 mb-1">What I&apos;m looking for</p>
            <p className="text-sm text-green-900 leading-relaxed">
              {p?.value_sought ?? <span className="text-green-900/25 italic">Not filled in</span>}
            </p>
          </div>
        </div>

        {/* Hobbies */}
        <div className="px-5 py-4 border-b border-green-900/08">
          <p className="text-xs uppercase tracking-widest text-green-900/40 mb-2">Hobbies</p>
          <p className="text-sm text-green-900 leading-relaxed">
            {p?.non_golf_hobbies ?? <span className="text-green-900/25 italic">Not filled in</span>}
          </p>
        </div>

        {/* Focus LinkUps groups */}
        <div className="px-5 py-4 border-b border-green-900/08">
          <p className="text-xs uppercase tracking-widest text-green-900/40 mb-3">Focus LinkUps groups</p>
          {focusGroups.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {focusGroups.map(g => (
                <span key={g} className="text-xs bg-green-50 text-green-900 px-2.5 py-1 rounded-full border border-green-900/10">
                  {g}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-green-900/25 italic">No Focus LinkUp groups</p>
          )}
        </div>

        {/* Events this member is hosting */}
        {hostedEvents.length > 0 && (
          <div className="px-5 py-4 border-b border-green-900/08">
            <p className="text-xs uppercase tracking-widest text-green-900/40 mb-3">Hosting</p>
            <div className="space-y-2">
              {hostedEvents.map(e => {
                const remaining = e.remaining_spots ?? 0;
                return (
                  <Link
                    key={e.id}
                    href={`/more/hosted-events/${e.id}`}
                    className="flex items-center justify-between gap-3 bg-green-50 rounded-xl px-3 py-2.5 border border-green-900/10"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-green-950 truncate">{e.course?.name ?? "Hosted event"}</p>
                      <p className="text-xs text-green-900/50">
                        {new Date(`${e.event_date.slice(0, 10)}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        {" · "}{remaining > 0 ? `${remaining} spot${remaining === 1 ? "" : "s"} left` : "Full"}
                      </p>
                    </div>
                    <span className="text-xs font-medium text-green-800 flex-shrink-0">View →</span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

      </div>
    </AppShell>
  );
}

// ---- Inline icons -------------------------------------------
function LinkedInIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
    </svg>
  );
}
