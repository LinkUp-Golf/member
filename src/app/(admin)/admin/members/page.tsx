"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase";
import { useProfile } from "@/hooks/useProfile";
import {
  AdminTable,
  AdminTr,
  AdminTd,
  Badge,
  AdminButton,
} from "@/components/admin/AdminUI";
import { format, formatDistanceToNow } from "date-fns";
import type { MemberWithProfile } from "@/types";

type FilterStatus =
  | "all"
  | "active"
  | "waitlist"
  | "pending"
  | "suspended"
  | "cancelled";

export default function AdminMembersPage() {
  const { user } = useProfile();
  const currentUserId = user?.id;
  const [members, setMembers] = useState<MemberWithProfile[]>([]);
  const [filtered, setFiltered] = useState<MemberWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const [selected, setSelected] = useState<MemberWithProfile | null>(null);
  const [panelMounted, setPanelMounted] = useState(false);
  const [panelVisible, setPanelVisible] = useState(false);
  const [panelData, setPanelData] = useState<MemberWithProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{
    total: number;
    synced: number;
    skipped: number;
    errors: string[];
  } | null>(null);

  useEffect(() => {
    loadMembers();
  }, []);

  // Animate panel open/close; panelData persists during the exit transition
  useEffect(() => {
    if (selected) {
      setPanelData(selected);
      setPanelMounted(true);
      const ids: number[] = [];
      ids[0] = requestAnimationFrame(() => {
        ids[1] = requestAnimationFrame(() => setPanelVisible(true));
      });
      return () => ids.forEach((id) => cancelAnimationFrame(id));
    } else {
      setPanelVisible(false);
      const t = setTimeout(() => {
        setPanelMounted(false);
        setPanelData(null);
      }, 320);
      return () => clearTimeout(t);
    }
  }, [selected]);

  useEffect(() => {
    let result = members;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (m) =>
          `${m.first_name} ${m.last_name}`.toLowerCase().includes(q) ||
          m.email.toLowerCase().includes(q) ||
          m.profile?.business_name?.toLowerCase().includes(q) ||
          m.profile?.industry_category?.toLowerCase().includes(q),
      );
    }
    if (statusFilter !== "all") {
      result = result.filter((m) => m.membership_status === statusFilter);
    }
    setFiltered(result);
  }, [search, statusFilter, members]);

  async function loadMembers() {
    const supabase = createClient();
    const { data } = await supabase
      .from("members")
      .select("*, profile:member_profiles(*), home_course:courses!members_home_course_id_fkey(*)")
      .order("created_at", { ascending: false });
    setMembers((data ?? []) as MemberWithProfile[]);
    setFiltered((data ?? []) as MemberWithProfile[]);
    setLoading(false);
  }

  async function updateStatus(memberId: string, status: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/members/${memberId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.error("[updateStatus] failed:", data);
      }
    } catch (e) {
      console.error("[updateStatus] error:", e);
    }
    await loadMembers();
    if (selected?.id === memberId) {
      setSelected((prev) =>
        prev
          ? {
              ...prev,
              membership_status:
                status as MemberWithProfile["membership_status"],
            }
          : null,
      );
    }
    setSaving(false);
  }

  async function bulkSyncFromGHL() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/admin/sync", { method: "POST" });
      const json = await res.json();
      setSyncResult(json);
      await loadMembers();
    } catch {
      setSyncResult({
        total: 0,
        synced: 0,
        skipped: 0,
        errors: ["Request failed"],
      });
    } finally {
      setSyncing(false);
    }
  }

  async function toggleAdmin(memberId: string, isAdmin: boolean) {
    setSaving(true);
    const supabase = createClient();
    await supabase
      .from("members")
      .update({ is_admin: !isAdmin })
      .eq("id", memberId);
    await loadMembers();
    setSaving(false);
  }

  const statusCounts = {
    all: members.length,
    active: members.filter((m) => m.membership_status === "active").length,
    waitlist: members.filter((m) => m.membership_status === "waitlist").length,
    pending: members.filter((m) => m.membership_status === "pending").length,
    suspended: members.filter((m) => m.membership_status === "suspended")
      .length,
    cancelled: members.filter((m) => m.membership_status === "cancelled")
      .length,
  };

  return (
    <div className="p-4 sm:p-8">
      <div className="flex items-start justify-between gap-4 mb-6 sm:mb-8">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-gray-900">
            Members
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {statusCounts.active} active · {statusCounts.waitlist} waitlisted ·{" "}
            {statusCounts.pending} pending
            {statusCounts.suspended > 0 && (
              <span className="text-red-500">
                {" "}
                · {statusCounts.suspended} suspended
              </span>
            )}
          </p>
        </div>
        <button
          onClick={bulkSyncFromGHL}
          disabled={syncing}
          className="flex-shrink-0 px-3 py-2 text-sm font-medium rounded-xl bg-green-900 text-white hover:bg-green-800 disabled:opacity-60 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
        >
          {syncing ? "Syncing…" : "Sync from GHL"}
        </button>
      </div>

      {syncResult && (
        <div
          className={`mb-4 p-3 rounded-xl text-sm border ${syncResult.errors.length > 0 ? "bg-yellow-50 border-yellow-200 text-yellow-800" : "bg-green-50 border-green-200 text-green-800"}`}
        >
          <span className="font-medium">Sync complete:</span>{" "}
          {syncResult.synced} synced, {syncResult.skipped} skipped
          {syncResult.errors.length > 0 && (
            <div className="mt-1 text-xs text-yellow-700">
              {syncResult.errors.slice(0, 3).join(" · ")}
              {syncResult.errors.length > 3
                ? ` +${syncResult.errors.length - 3} more`
                : ""}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-6">
        {/* Main list */}
        <div className="flex-1 min-w-0">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 mb-4 sm:items-center">
            <input
              type="search"
              placeholder="Search members…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full sm:flex-1 px-4 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-green-500"
            />
            <div className="flex gap-1 flex-wrap">
              {(
                [
                  "all",
                  "active",
                  "waitlist",
                  "pending",
                  "suspended",
                  "cancelled",
                ] as FilterStatus[]
              ).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                    statusFilter === s
                      ? s === "suspended"
                        ? "bg-red-600 text-white"
                        : "bg-green-900 text-white"
                      : s === "suspended" && statusCounts.suspended > 0
                        ? "bg-red-50 border border-red-200 text-red-600 hover:bg-red-100"
                        : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {s}{" "}
                  {statusCounts[s] > 0 && (
                    <span className="ml-0.5 opacity-60">
                      ({statusCounts[s]})
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <AdminTable
            headers={[
              "Member",
              "Category",
              "Status",
              "Last Sign In",
              "Joined",
              "Actions",
            ]}
            empty={
              loading
                ? "Loading…"
                : filtered.length === 0
                  ? "No members match your search."
                  : undefined
            }
          >
            {filtered.map((m) => (
              <AdminTr key={m.id} onClick={() => setSelected(m)}>
                <AdminTd>
                  <div>
                    <p className="font-medium text-gray-900 capitalize">
                      {m.first_name}{" "}
                      {m.last_name}
                    </p>
                    <p className="text-xs text-gray-400">{m.email}</p>
                    {m.profile?.business_name && (
                      <p className="text-xs text-gray-400">
                        {m.profile.business_name}
                      </p>
                    )}
                  </div>
                </AdminTd>
                <AdminTd>
                  <span className="text-xs text-gray-500">
                    {m.profile?.industry_category ?? "—"}
                  </span>
                </AdminTd>
                <AdminTd>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <StatusBadge status={m.membership_status} />
                    {m.is_admin && (
                      <span className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full">
                        Admin
                      </span>
                    )}
                  </div>
                </AdminTd>
                <AdminTd>
                  <span className="text-xs text-gray-400">
                    {m.last_sign_in ? (
                      formatDistanceToNow(new Date(m.last_sign_in), {
                        addSuffix: true,
                      })
                    ) : (
                      <span className="text-gray-300">Never</span>
                    )}
                  </span>
                </AdminTd>
                <AdminTd>
                  <span className="text-xs text-gray-400">
                    {m.membership_start_date
                      ? format(new Date(m.membership_start_date), "MMM d, yyyy")
                      : format(new Date(m.created_at), "MMM d, yyyy")}
                  </span>
                </AdminTd>
                <AdminTd>
                  <div
                    className="flex gap-1.5"
                    role="presentation"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    {(m.membership_status === "waitlist" ||
                      m.membership_status === "pending") && (
                      <AdminButton
                        label="Approve"
                        onClick={() => updateStatus(m.id, "active")}
                        variant="gold"
                        size="sm"
                        disabled={saving}
                      />
                    )}
                    {m.membership_status === "active" &&
                      m.id !== currentUserId && (
                        <AdminButton
                          label="Suspend"
                          onClick={() => updateStatus(m.id, "suspended")}
                          variant="danger"
                          size="sm"
                          disabled={saving}
                        />
                      )}
                    {(m.membership_status === "suspended" ||
                      m.membership_status === "cancelled") && (
                      <AdminButton
                        label="Reinstate"
                        onClick={() => updateStatus(m.id, "active")}
                        variant="primary"
                        size="sm"
                        disabled={saving}
                      />
                    )}
                  </div>
                </AdminTd>
              </AdminTr>
            ))}
          </AdminTable>
        </div>

        {/* Member detail panel — bottom sheet on mobile, inline on desktop */}
        {panelMounted && panelData && (
          <>
            {/* Mobile backdrop */}
            <div
              className={[
                "fixed inset-0 bg-black/40 z-40 lg:hidden",
                panelVisible ? "opacity-100" : "opacity-0",
              ].join(" ")}
              style={{ transition: "opacity 200ms ease-out", willChange: "opacity" }}
              role="presentation"
              onClick={() => setSelected(null)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setSelected(null);
              }}
            />
            {/* Sheet / panel */}
            <div
              className={[
                "fixed bottom-0 left-0 right-0 z-50 lg:static lg:z-auto lg:w-72 lg:flex-shrink-0 lg:transform-none",
                panelVisible ? "translate-y-0" : "translate-y-full",
              ].join(" ")}
              style={{
                transition: panelVisible
                  ? "transform 340ms cubic-bezier(0.32,0.72,0,1)"
                  : "transform 240ms cubic-bezier(0.4,0,1,1)",
                willChange: "transform",
              }}>
              <div className="bg-white rounded-t-2xl lg:rounded-xl border-t lg:border border-gray-200 shadow-2xl lg:shadow-sm max-h-[85vh] overflow-y-auto">
                <div className="p-4 sm:p-5">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <p className="font-semibold text-gray-900 capitalize">
                        {panelData.first_name}{" "}
                        {panelData.last_name}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {panelData.email}
                      </p>
                    </div>
                    <button
                      onClick={() => setSelected(null)}
                      className="text-gray-300 hover:text-gray-500 text-lg"
                    >
                      ×
                    </button>
                  </div>

                  <div className="space-y-3 text-sm">
                    <DetailRow label="Status">
                      <StatusBadge status={panelData.membership_status} />
                    </DetailRow>
                    <DetailRow label="Category">
                      {panelData.profile?.industry_category ?? "—"}
                    </DetailRow>
                    <DetailRow label="Business">
                      {panelData.profile?.business_name ?? "—"}
                    </DetailRow>
                    <DetailRow label="Role">
                      {panelData.profile?.role_title ?? "—"}
                    </DetailRow>
                    <DetailRow label="Last sign in">
                      {panelData.last_sign_in
                        ? formatDistanceToNow(new Date(panelData.last_sign_in), {
                            addSuffix: true,
                          })
                        : "Never"}
                    </DetailRow>
                    <DetailRow label="GHL ID">
                      <span className="font-mono text-xs text-gray-400">
                        {panelData.ghl_contact_id}
                      </span>
                    </DetailRow>

                    {panelData.profile?.handicap_index &&
                      panelData.profile?.show_handicap && (
                        <DetailRow label="Handicap">
                          {panelData.profile.handicap_index}
                        </DetailRow>
                      )}
                  </div>

                  {panelData.profile?.value_offered && (
                    <div className="mt-4 pt-4 border-t border-gray-100">
                      <p className="text-xs text-gray-400 uppercase tracking-wider mb-1.5">
                        Value offered
                      </p>
                      <p className="text-xs text-gray-600 leading-relaxed">
                        {panelData.profile.value_offered}
                      </p>
                    </div>
                  )}

                  {panelData.profile?.value_sought && (
                    <div className="mt-3">
                      <p className="text-xs text-gray-400 uppercase tracking-wider mb-1.5">
                        Looking for
                      </p>
                      <p className="text-xs text-gray-600 leading-relaxed">
                        {panelData.profile.value_sought}
                      </p>
                    </div>
                  )}

                  {/* Admin actions */}
                  <div className="mt-5 pt-4 border-t border-gray-100 space-y-2">
                    <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">
                      Actions
                    </p>
                    {(panelData.membership_status === "waitlist" ||
                      panelData.membership_status === "pending") && (
                      <AdminButton
                        label="Approve membership"
                        onClick={() => updateStatus(panelData.id, "active")}
                        variant="gold"
                        disabled={saving}
                      />
                    )}
                    {panelData.membership_status === "active" &&
                      panelData.id !== currentUserId && (
                        <AdminButton
                          label="Suspend membership"
                          onClick={() => updateStatus(panelData.id, "suspended")}
                          variant="danger"
                          disabled={saving}
                        />
                      )}
                    {panelData.membership_status === "suspended" && (
                      <AdminButton
                        label="Reinstate membership"
                        onClick={() => updateStatus(panelData.id, "active")}
                        variant="primary"
                        disabled={saving}
                      />
                    )}
                    <AdminButton
                      label={
                        panelData.is_admin
                          ? "Remove admin access"
                          : "Grant admin access"
                      }
                      onClick={() =>
                        toggleAdmin(panelData.id, panelData.is_admin)
                      }
                      variant="ghost"
                      disabled={saving}
                    />
                  </div>
                </div>
                {/* /p-4 */}
              </div>
              {/* /sheet panel */}
            </div>
            {/* /fixed wrapper */}
          </>
        )}
      </div>
    </div>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="text-xs text-gray-400 flex-shrink-0">{label}</span>
      <span className="text-xs text-gray-700 text-right">{children}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<
    string,
    { label: string; colour: "green" | "yellow" | "blue" | "red" | "gray" }
  > = {
    active: { label: "Active", colour: "green" },
    waitlist: { label: "Waitlist", colour: "yellow" },
    pending: { label: "Pending", colour: "blue" },
    suspended: { label: "Suspended", colour: "red" },
    cancelled: { label: "Cancelled", colour: "gray" },
  };
  const s = map[status] ?? { label: status, colour: "gray" as const };
  return <Badge label={s.label} colour={s.colour} />;
}
