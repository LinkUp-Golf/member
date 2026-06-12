"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase";
import { COURSE_SLUGS } from "@/lib/ghl/tags";
import {
  AdminPageHeader,
  AdminTable,
  AdminTr,
  AdminTd,
  AdminButton,
  AdminCard,
} from "@/components/admin/AdminUI";
import { INDUSTRY_CATEGORIES } from "@/types";
import { format } from "date-fns";
import type { FocusLinkup } from "@/types";

interface CustomGroupRequest {
  id: string
  custom_label: string
  status: 'pending' | 'approved' | 'declined'
  created_at: string
  member_id: string
  first_name: string
  last_name: string
}

export default function AdminFocusLinkupsPage() {
  const [linkups, setLinkups] = useState<FocusLinkup[]>([]);
  const [customRequests, setCustomRequests] = useState<CustomGroupRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [courseId, setCourseId] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const supabase = createClient();
    const { data: courses } = await supabase
      .from("courses")
      .select("id")
      .in("slug", COURSE_SLUGS);
    const courseIds = (courses ?? []).map(c => c.id);
    if (courseIds[0]) setCourseId(courseIds[0]);

    const [linkupsRes, subsRes] = await Promise.all([
      supabase
        .from("focus_linkups")
        .select("*")
        .order("focus_date", { ascending: true }),
      supabase
        .from("focus_linkup_subscriptions")
        .select("id, custom_label, status, created_at, member_id, members(first_name, last_name)")
        .eq("industry_focus", "Other")
        .not("custom_label", "is", null)
        .order("created_at", { ascending: false }),
    ]);

    setLinkups(linkupsRes.data ?? []);
    setCustomRequests(
      (subsRes.data ?? []).map((r: Record<string, unknown>) => {
        const m = r.members as { first_name: string; last_name: string } | null
        return {
          id: r.id as string,
          custom_label: r.custom_label as string,
          status: (r.status ?? 'pending') as 'pending' | 'approved' | 'declined',
          created_at: r.created_at as string,
          member_id: r.member_id as string,
          first_name: m?.first_name ?? '',
          last_name: m?.last_name ?? '',
        }
      })
    );
    setLoading(false);
  }

  async function reviewRequest(id: string, action: 'approved' | 'declined') {
    await fetch('/api/admin/focus-linkups', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status: action }),
    });
    setCustomRequests(prev =>
      prev.map(r => r.id === id ? { ...r, status: action } : r)
    );
  }

  async function deleteLinkup(id: string) {
    if (!confirm("Delete this Focus LinkUp?")) return;
    const supabase = createClient();
    await supabase.from("focus_linkups").delete().eq("id", id);
    await loadData();
  }

  async function sendNotification(id: string, type: "2w" | "1w") {
    // In production, trigger GHL workflow for subscribed members
    const supabase = createClient();
    const field =
      type === "2w" ? "notification_sent_2w" : "notification_sent_1w";
    await supabase
      .from("focus_linkups")
      .update({ [field]: true })
      .eq("id", id);
    await loadData();
    alert(
      `${type === "2w" ? "2-week" : "1-week"} notification sent to subscribed members.`,
    );
  }

  const todayISO = new Date().toISOString().slice(0, 10);
  const upcoming = linkups.filter((l) => l.focus_date >= todayISO);
  const past = linkups.filter((l) => l.focus_date < todayISO);

  return (
    <div className="p-4 sm:p-8">
      <AdminPageHeader
        title="Focus LinkUps"
        description={`${upcoming.length} upcoming · ${past.length} past`}
        action={
          <AdminButton
            label="+ Create Focus LinkUp"
            onClick={() => setShowForm(true)}
            variant="gold"
          />
        }
      />

      {showForm && (
        <div className="mb-6">
          <CreateFocusLinkupForm
            courseId={courseId}
            onCreated={() => {
              setShowForm(false);
              loadData();
            }}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      {/* Upcoming */}
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
        Upcoming
      </h2>
      <AdminTable
        headers={[
          "Title",
          "Date",
          "Industry focus",
          "2wk notif",
          "1wk notif",
          "Actions",
        ]}
        empty={
          loading
            ? "Loading…"
            : upcoming.length === 0
              ? "No upcoming Focus LinkUps. Create one above."
              : undefined
        }
      >
        {upcoming.map((l) => (
          <AdminTr key={l.id}>
            <AdminTd>
              <p className="font-medium text-gray-900">{l.title}</p>
            </AdminTd>
            <AdminTd>
              <p className="text-sm">
                {format(new Date(l.focus_date + "T12:00:00"), "EEE, MMM d")}
              </p>
              <p className="text-xs text-gray-400">{l.tee_time?.slice(0, 5)}</p>
            </AdminTd>
            <AdminTd>
              <div className="flex flex-wrap gap-1 max-w-xs">
                {(l.industry_focus ?? []).map((f: string) => (
                  <span
                    key={f}
                    className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full"
                  >
                    {f}
                  </span>
                ))}
              </div>
            </AdminTd>
            <AdminTd>
              {l.notification_sent_2w ? (
                <span className="text-xs text-green-600">Sent ✓</span>
              ) : (
                <AdminButton
                  label="Send"
                  onClick={() => sendNotification(l.id, "2w")}
                  variant="ghost"
                  size="sm"
                />
              )}
            </AdminTd>
            <AdminTd>
              {l.notification_sent_1w ? (
                <span className="text-xs text-green-600">Sent ✓</span>
              ) : (
                <AdminButton
                  label="Send"
                  onClick={() => sendNotification(l.id, "1w")}
                  variant="ghost"
                  size="sm"
                />
              )}
            </AdminTd>
            <AdminTd>
              <AdminButton
                label="Delete"
                onClick={() => deleteLinkup(l.id)}
                variant="danger"
                size="sm"
              />
            </AdminTd>
          </AdminTr>
        ))}
      </AdminTable>

      {/* Custom group requests */}
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 mt-8">
        Custom group requests
        {customRequests.filter(r => r.status === 'pending').length > 0 && (
          <span className="ml-2 text-xs font-medium text-yellow-700 bg-yellow-50 border border-yellow-200 px-2 py-0.5 rounded-full normal-case">
            {customRequests.filter(r => r.status === 'pending').length} pending
          </span>
        )}
      </h2>
      <AdminTable
        headers={["Member", "Custom group", "Status", "Requested", "Actions"]}
        empty={loading ? "Loading…" : customRequests.length === 0 ? "No custom group requests yet." : undefined}
      >
        {customRequests.map((r) => (
          <AdminTr key={r.id}>
            <AdminTd>
              <p className="text-sm font-medium text-gray-900">
                {r.first_name} {r.last_name}
              </p>
            </AdminTd>
            <AdminTd>
              <span className="text-xs bg-yellow-50 text-yellow-800 border border-yellow-200 px-2 py-0.5 rounded-full">
                {r.custom_label}
              </span>
            </AdminTd>
            <AdminTd>
              {r.status === 'pending' && (
                <span className="text-xs text-yellow-700 font-medium">Pending</span>
              )}
              {r.status === 'approved' && (
                <span className="text-xs text-green-600 font-medium">Approved ✓</span>
              )}
              {r.status === 'declined' && (
                <span className="text-xs text-red-500 font-medium">Declined ✗</span>
              )}
            </AdminTd>
            <AdminTd>
              <span className="text-xs text-gray-400">
                {format(new Date(r.created_at), "MMM d, yyyy")}
              </span>
            </AdminTd>
            <AdminTd>
              {r.status === 'pending' ? (
                <div className="flex gap-2">
                  <AdminButton
                    label="Approve"
                    onClick={() => reviewRequest(r.id, 'approved')}
                    variant="ghost"
                    size="sm"
                  />
                  <AdminButton
                    label="Decline"
                    onClick={() => reviewRequest(r.id, 'declined')}
                    variant="danger"
                    size="sm"
                  />
                </div>
              ) : (
                <span className="text-xs text-gray-300">—</span>
              )}
            </AdminTd>
          </AdminTr>
        ))}
      </AdminTable>

      {past.length > 0 && (
        <>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 mt-8">
            Past
          </h2>
          <AdminTable headers={["Title", "Date", "Industry focus"]} empty="">
            {past.slice(0, 10).map((l) => (
              <AdminTr key={l.id}>
                <AdminTd>
                  <p className="text-gray-500">{l.title}</p>
                </AdminTd>
                <AdminTd>
                  <span className="text-xs text-gray-400">
                    {format(
                      new Date(l.focus_date + "T12:00:00"),
                      "MMM d, yyyy",
                    )}
                  </span>
                </AdminTd>
                <AdminTd>
                  <div className="flex flex-wrap gap-1">
                    {(l.industry_focus ?? []).map((f: string) => (
                      <span
                        key={f}
                        className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full"
                      >
                        {f}
                      </span>
                    ))}
                  </div>
                </AdminTd>
              </AdminTr>
            ))}
          </AdminTable>
        </>
      )}
    </div>
  );
}

function CreateFocusLinkupForm({
  courseId,
  onCreated,
  onCancel,
}: {
  courseId: string;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const today = new Date().toISOString().split("T")[0];
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("07:30");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  function toggleCategory(cat: string) {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    );
  }

  async function handleSubmit() {
    if (!title || !date || selectedCategories.length === 0) return;
    setSaving(true);
    const supabase = createClient();
    await supabase.from("focus_linkups").insert({
      course_id: courseId,
      title,
      description,
      focus_date: date,
      tee_time: time + ":00",
      industry_focus: selectedCategories,
    });
    setSaving(false);
    onCreated();
  }

  return (
    <AdminCard title="Create Focus LinkUp">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div className="col-span-1 sm:col-span-2">
          <label
            htmlFor="fl-title"
            className="text-xs text-gray-400 mb-1 block"
          >
            Title
          </label>
          <input
            id="fl-title"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-green-500"
            placeholder="Life Sciences LinkUp"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="fl-date" className="text-xs text-gray-400 mb-1 block">
            Date
          </label>
          <input
            id="fl-date"
            type="date"
            min={today}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-green-500"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="fl-time" className="text-xs text-gray-400 mb-1 block">
            Tee time
          </label>
          <input
            id="fl-time"
            type="time"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-green-500"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </div>
        <div className="col-span-1 sm:col-span-2">
          <label
            htmlFor="fl-description"
            className="text-xs text-gray-400 mb-1 block"
          >
            Description
          </label>
          <textarea
            id="fl-description"
            rows={2}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-green-500 resize-none"
            placeholder="Brief description for notifications…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="col-span-1 sm:col-span-2">
          <p className="text-xs text-gray-400 mb-2">
            Industry focus (select all that apply)
          </p>
          <div className="flex flex-wrap gap-2">
            {INDUSTRY_CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => toggleCategory(cat)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  selectedCategories.includes(cat)
                    ? "bg-green-900 text-white border-green-900"
                    : "border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="flex gap-3 justify-end">
        <AdminButton label="Cancel" onClick={onCancel} variant="ghost" />
        <AdminButton
          label={saving ? "Creating…" : "Create Focus LinkUp"}
          onClick={handleSubmit}
          variant="gold"
          disabled={
            !title || !date || selectedCategories.length === 0 || saving
          }
        />
      </div>
    </AdminCard>
  );
}
