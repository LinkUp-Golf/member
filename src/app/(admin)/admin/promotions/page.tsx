"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase";
import {
  AdminPageHeader,
  AdminTable,
  AdminTr,
  AdminTd,
  AdminButton,
  AdminCard,
  Badge,
} from "@/components/admin/AdminUI";
import { formatBookingDate } from "@/lib/utils";
import MediaUpload from "@/components/ui/MediaUpload";
import type { Promotion } from "@/types";

interface PromotionPayload {
  title: string;
  description: string;
  partner_name: string;
  badge_label: string;
  cta_label: string;
  cta_url: string | null;
  expires_at: string | null;
  course_id: string | null;
  image_url: string | null;
  video_url: string | null;
}

export default function AdminPromotionsPage() {
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<Promotion | null>(null);
  const [courseId, setCourseId] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const supabase = createClient();
    const { data: course } = await supabase
      .from("courses")
      .select("id")
      .eq("slug", "aviara")
      .single();
    if (course) setCourseId(course.id);
    const { data } = await supabase
      .from("promotions")
      .select("*")
      .order("sort_order")
      .order("created_at", { ascending: false });
    setPromotions(data ?? []);
    setLoading(false);
  }

  async function handleCreate(
    payload: PromotionPayload,
  ): Promise<string | null> {
    const res = await fetch("/api/admin/promotions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) return json.error?.message ?? json.error ?? "Failed to create";
    await loadData();
    setShowCreate(false);
    return null;
  }

  async function handleUpdate(
    id: string,
    payload: PromotionPayload,
  ): Promise<string | null> {
    const res = await fetch(`/api/admin/promotions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) return json.error?.message ?? json.error ?? "Failed to update";
    await loadData();
    setEditTarget(null);
    return null;
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this promotion?")) return;
    const res = await fetch(`/api/admin/promotions/${id}`, {
      method: "DELETE",
    });
    if (res.ok) await loadData();
  }

  async function toggleActive(id: string, active: boolean) {
    await fetch(`/api/admin/promotions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !active }),
    });
    await loadData();
  }

  function openCreate() {
    setShowCreate(true);
    setEditTarget(null);
  }
  function openEdit(p: Promotion) {
    setEditTarget(p);
    setShowCreate(false);
  }

  return (
    <div className="p-4 sm:p-8">
      <AdminPageHeader
        title="Promotions"
        description={`${promotions.filter((p) => p.active).length} active · ${promotions.filter((p) => !p.active).length} inactive`}
        action={
          <AdminButton
            label="+ Add promotion"
            onClick={openCreate}
            variant="gold"
          />
        }
      />

      {showCreate && !editTarget && (
        <div className="mb-6">
          <PromotionForm
            courseId={courseId}
            onSubmit={handleCreate}
            onCancel={() => setShowCreate(false)}
          />
        </div>
      )}

      {editTarget && (
        <div className="mb-6">
          <PromotionForm
            initial={editTarget}
            courseId={courseId}
            onSubmit={(p) => handleUpdate(editTarget.id, p)}
            onCancel={() => setEditTarget(null)}
          />
        </div>
      )}

      <AdminTable
        headers={[
          "Promotion",
          "Partner",
          "Scope",
          "Expires",
          "Status",
          "Actions",
        ]}
        empty={
          loading
            ? "Loading…"
            : promotions.length === 0
              ? "No promotions yet."
              : undefined
        }
      >
        {promotions.map((p) => (
          <AdminTr key={p.id}>
            <AdminTd>
              <p className="font-medium text-gray-900">{p.title}</p>
              <p className="text-xs text-gray-400 mt-0.5 max-w-sm truncate">
                {p.description}
              </p>
            </AdminTd>
            <AdminTd>
              <p className="text-sm">{p.partner_name}</p>
              <p className="text-xs text-gray-400">{p.badge_label}</p>
            </AdminTd>
            <AdminTd>
              <Badge
                label={p.course_id ? "Aviara only" : "All courses"}
                colour={p.course_id ? "blue" : "green"}
              />
            </AdminTd>
            <AdminTd>
              <span className="text-sm text-gray-600">
                {p.expires_at ? (
                  formatBookingDate(p.expires_at)
                ) : (
                  <span className="text-gray-300">No expiry</span>
                )}
              </span>
            </AdminTd>
            <AdminTd>
              <Badge
                label={p.active ? "Active" : "Inactive"}
                colour={p.active ? "green" : "gray"}
              />
            </AdminTd>
            <AdminTd>
              <div className="flex gap-1.5">
                <AdminButton
                  label={p.active ? "Deactivate" : "Activate"}
                  onClick={() => toggleActive(p.id, p.active)}
                  variant="ghost"
                  size="sm"
                />
                <AdminButton
                  label="Edit"
                  onClick={() => openEdit(p)}
                  variant="ghost"
                  size="sm"
                />
                <AdminButton
                  label="Delete"
                  onClick={() => handleDelete(p.id)}
                  variant="danger"
                  size="sm"
                />
              </div>
            </AdminTd>
          </AdminTr>
        ))}
      </AdminTable>
    </div>
  );
}

function PromotionForm({
  initial,
  courseId,
  onSubmit,
  onCancel,
}: {
  initial?: Promotion;
  courseId: string;
  onSubmit: (payload: PromotionPayload) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [partner, setPartner] = useState(initial?.partner_name ?? "");
  const [badge, setBadge] = useState(initial?.badge_label ?? "");
  const [ctaLabel, setCtaLabel] = useState(initial?.cta_label ?? "Learn more");
  const [ctaUrl, setCtaUrl] = useState(initial?.cta_url ?? "");
  const [expires, setExpires] = useState(
    initial?.expires_at ? initial.expires_at.slice(0, 10) : "",
  );
  const [allCourses, setAllCourses] = useState(
    initial ? initial.course_id === null : true,
  );
  const [imageUrl, setImageUrl] = useState<string | null>(
    initial?.image_url ?? null,
  );
  const [videoUrl, setVideoUrl] = useState<string | null>(
    initial?.video_url ?? null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditing = !!initial;

  async function handleSubmit() {
    if (!title || !description || !partner || !badge) return;
    setSaving(true);
    setError(null);
    try {
      const err = await onSubmit({
        title,
        description,
        partner_name: partner,
        badge_label: badge,
        cta_label: ctaLabel,
        cta_url: ctaUrl.trim() || null,
        expires_at: expires || null,
        course_id: allCourses ? null : courseId,
        image_url: imageUrl,
        video_url: videoUrl,
      });
      if (err) setError(err);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unexpected error.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminCard title={isEditing ? "Edit promotion" : "Add promotion"}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div className="col-span-1 sm:col-span-2">
          <label
            htmlFor="promo-title"
            className="text-xs text-gray-400 mb-1 block"
          >
            Title
          </label>
          <input
            id="promo-title"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-green-500"
            placeholder="Complimentary Club Fitting"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div>
          <label
            htmlFor="promo-partner"
            className="text-xs text-gray-400 mb-1 block"
          >
            Partner name
          </label>
          <input
            id="promo-partner"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-green-500"
            placeholder="Aviara Pro Shop"
            value={partner}
            onChange={(e) => setPartner(e.target.value)}
          />
        </div>
        <div>
          <label
            htmlFor="promo-badge"
            className="text-xs text-gray-400 mb-1 block"
          >
            Badge label
          </label>
          <input
            id="promo-badge"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-green-500"
            placeholder="Pro Shop · Aviara"
            value={badge}
            onChange={(e) => setBadge(e.target.value)}
          />
        </div>
        <div className="col-span-1 sm:col-span-2">
          <label
            htmlFor="promo-description"
            className="text-xs text-gray-400 mb-1 block"
          >
            Description
          </label>
          <textarea
            id="promo-description"
            rows={3}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-green-500 resize-none"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div>
          <label
            htmlFor="promo-cta-label"
            className="text-xs text-gray-400 mb-1 block"
          >
            CTA button label
          </label>
          <input
            id="promo-cta-label"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-green-500"
            value={ctaLabel}
            onChange={(e) => setCtaLabel(e.target.value)}
          />
        </div>
        <div>
          <label
            htmlFor="promo-cta-url"
            className="text-xs text-gray-400 mb-1 block"
          >
            CTA URL (optional)
          </label>
          <input
            id="promo-cta-url"
            type="url"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-green-500"
            placeholder="https://…"
            value={ctaUrl ?? ""}
            onChange={(e) => setCtaUrl(e.target.value)}
          />
        </div>
        <div>
          <label
            htmlFor="promo-expires"
            className="text-xs text-gray-400 mb-1 block"
          >
            Expiry date (optional)
          </label>
          <input
            id="promo-expires"
            type="date"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-green-500"
            value={expires}
            onChange={(e) => setExpires(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-3 mt-4">
          <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-600">
            <input
              type="checkbox"
              checked={allCourses}
              onChange={(e) => setAllCourses(e.target.checked)}
              className="rounded"
            />
            Show on all courses
          </label>
        </div>
        <div className="col-span-1 sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <MediaUpload
            label="Image (optional)"
            value={imageUrl}
            onChange={setImageUrl}
            mediaType="image"
            folder="promotions"
          />
          <MediaUpload
            label="Video (optional)"
            value={videoUrl}
            onChange={setVideoUrl}
            mediaType="video"
            folder="promotions"
          />
        </div>
      </div>
      {error && (
        <p className="mt-3 text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
      <div className="flex gap-3 justify-end mt-4">
        <AdminButton label="Cancel" onClick={onCancel} variant="ghost" />
        <AdminButton
          label={
            saving
              ? isEditing
                ? "Saving…"
                : "Creating…"
              : isEditing
                ? "Save changes"
                : "Create promotion"
          }
          onClick={handleSubmit}
          variant="gold"
          disabled={!title || !description || !partner || !badge || saving}
        />
      </div>
    </AdminCard>
  );
}
