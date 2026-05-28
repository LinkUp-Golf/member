"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { useForm } from "react-hook-form";
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
import FormField from "@/components/admin/FormField";
import { formatBookingDate } from "@/lib/utils";
import MultiMediaUpload, { type MediaFile } from "@/components/ui/MultiMediaUpload";
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
  media_urls: string[];
}

export default function AdminPromotionsPage() {
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<Promotion | null>(null);
  const [courseId, setCourseId] = useState("");

  useEffect(() => { loadData() }, []);

  async function loadData() {
    const supabase = createClient();
    const { data: course } = await supabase.from("courses").select("id").eq("slug", "aviara").single();
    if (course) setCourseId(course.id);
    const { data } = await supabase
      .from("promotions")
      .select("*")
      .order("sort_order")
      .order("created_at", { ascending: false });
    setPromotions(data ?? []);
    setLoading(false);
  }

  async function handleCreate(payload: PromotionPayload): Promise<string | null> {
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

  async function handleUpdate(id: string, payload: PromotionPayload): Promise<string | null> {
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
    const res = await fetch(`/api/admin/promotions/${id}`, { method: "DELETE" });
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

  function openCreate() { setShowCreate(true); setEditTarget(null); }
  function openEdit(p: Promotion) { setEditTarget(p); setShowCreate(false); }

  return (
    <div className="p-4 sm:p-8">
      <AdminPageHeader
        title="Promotions"
        description={`${promotions.filter(p => p.active).length} active · ${promotions.filter(p => !p.active).length} inactive`}
        action={<AdminButton label="+ Add promotion" onClick={openCreate} variant="gold" />}
      />

      {showCreate && !editTarget && (
        <div className="mb-6">
          <PromotionForm courseId={courseId} onSubmit={handleCreate} onCancel={() => setShowCreate(false)} />
        </div>
      )}

      {editTarget && (
        <div className="mb-6">
          <PromotionForm
            initial={editTarget}
            courseId={courseId}
            onSubmit={p => handleUpdate(editTarget.id, p)}
            onCancel={() => setEditTarget(null)}
          />
        </div>
      )}

      <AdminTable
        headers={["Media", "Promotion", "Partner", "Scope", "Expires", "Status", "Actions"]}
        empty={loading ? "Loading…" : promotions.length === 0 ? "No promotions yet." : undefined}
      >
        {promotions.map(p => (
          <AdminTr key={p.id}>
            <AdminTd><PromotionThumb promo={p} /></AdminTd>
            <AdminTd>
              <p className="font-medium text-gray-900 max-w-xs truncate">{p.title}</p>
              <p className="text-xs text-gray-400 mt-0.5 max-w-xs line-clamp-2">{p.description}</p>
            </AdminTd>
            <AdminTd>
              <p className="text-sm">{p.partner_name}</p>
              <p className="text-xs text-gray-400">{p.badge_label}</p>
            </AdminTd>
            <AdminTd>
              <Badge label={p.course_id ? "Aviara only" : "All courses"} colour={p.course_id ? "blue" : "green"} />
            </AdminTd>
            <AdminTd>
              <span className="text-sm text-gray-600">
                {p.expires_at ? formatBookingDate(p.expires_at) : <span className="text-gray-300">No expiry</span>}
              </span>
            </AdminTd>
            <AdminTd>
              <Badge label={p.active ? "Active" : "Inactive"} colour={p.active ? "green" : "gray"} />
            </AdminTd>
            <AdminTd>
              <div className="flex gap-1.5">
                <AdminButton label={p.active ? "Deactivate" : "Activate"} onClick={() => toggleActive(p.id, p.active)} variant="ghost" size="sm" />
                <AdminButton label="Edit" onClick={() => openEdit(p)} variant="ghost" size="sm" />
                <AdminButton label="Delete" onClick={() => handleDelete(p.id)} variant="danger" size="sm" />
              </div>
            </AdminTd>
          </AdminTr>
        ))}
      </AdminTable>
    </div>
  );
}

// ---- Thumbnail ----------------------------------------------

function PromotionThumb({ promo }: { promo: Promotion }) {
  const url = promo.media_urls?.[0] ?? promo.image_url ?? promo.video_url;
  if (!url) return <span className="text-gray-300 text-xs">—</span>;
  const ext = url.split('?')[0]?.split('.').pop()?.toLowerCase() ?? '';
  const isVideo = ['mp4', 'webm', 'mov', 'quicktime'].includes(ext);
  const count = promo.media_urls?.length ?? ((promo.image_url ? 1 : 0) + (promo.video_url ? 1 : 0));
  return (
    <div className="relative w-10 h-10 rounded-lg overflow-hidden bg-black flex-shrink-0">
      {isVideo ? (
        <video src={url} className="w-full h-full object-cover" muted playsInline />
      ) : (
        <Image src={url} alt="" fill className="object-cover" sizes="40px" />
      )}
      {count > 1 && (
        <div className="absolute bottom-0.5 right-0.5 bg-black/65 text-white text-[8px] font-semibold px-1 py-px rounded leading-none">
          {count}
        </div>
      )}
    </div>
  );
}

// ---- Form helpers -------------------------------------------

function mediaTypeFromUrl(url: string): 'image' | 'video' {
  const ext = url.split('?')[0]?.split('.').pop()?.toLowerCase() ?? '';
  return ['mp4', 'webm', 'mov', 'quicktime'].includes(ext) ? 'video' : 'image';
}

function initMediaFiles(promo: Promotion): MediaFile[] {
  if (promo.media_urls?.length) {
    return promo.media_urls.map(url => ({ id: crypto.randomUUID(), mediaType: mediaTypeFromUrl(url), previewUrl: url }));
  }
  const files: MediaFile[] = [];
  if (promo.image_url) files.push({ id: crypto.randomUUID(), mediaType: 'image', previewUrl: promo.image_url });
  if (promo.video_url) files.push({ id: crypto.randomUUID(), mediaType: 'video', previewUrl: promo.video_url });
  return files;
}

// ---- Form ---------------------------------------------------

interface PromotionFormValues {
  title: string;
  description: string;
  partner_name: string;
  badge_label: string;
  cta_label: string;
  cta_url: string;
  expires_at: string;
  allCourses: boolean;
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
  const {
    register,
    handleSubmit: rhfSubmit,
    formState: { errors, isSubmitting },
  } = useForm<PromotionFormValues>({
    defaultValues: {
      title: initial?.title ?? '',
      description: initial?.description ?? '',
      partner_name: initial?.partner_name ?? '',
      badge_label: initial?.badge_label ?? '',
      cta_label: initial?.cta_label ?? 'Learn more',
      cta_url: initial?.cta_url ?? '',
      expires_at: initial?.expires_at ? initial.expires_at.slice(0, 10) : '',
      allCourses: initial ? initial.course_id === null : true,
    },
  });

  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>(() => initial ? initMediaFiles(initial) : []);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const isEditing = !!initial;
  const saving = isSubmitting;

  function handleCancel() {
    mediaFiles.forEach(f => { if (f.file) URL.revokeObjectURL(f.previewUrl); });
    onCancel();
  }

  async function handleRemoveExisting(url: string) {
    const supabase = createClient();
    const marker = '/object/public/post-media/';
    const idx = url.indexOf(marker);
    if (idx !== -1) await supabase.storage.from('post-media').remove([url.slice(idx + marker.length)]);
  }

  async function onValid(values: PromotionFormValues) {
    setServerError(null);
    setUploadStatus(null);

    const uploadedPaths: string[] = [];
    async function cleanup() {
      if (uploadedPaths.length === 0) return;
      const supabase = createClient();
      await supabase.storage.from('post-media').remove(uploadedPaths);
    }

    try {
      const staged = mediaFiles.filter((f): f is MediaFile & { file: File } => !!f.file);
      const existing = mediaFiles.filter(f => !f.file);
      const resolved: { url: string; mediaType: 'image' | 'video' }[] = existing.map(f => ({ url: f.previewUrl, mediaType: f.mediaType }));

      let i = 0;
      for (const f of staged) {
        setUploadStatus(staged.length > 1 ? `Uploading ${f.mediaType} (${++i}/${staged.length})…` : `Uploading ${f.mediaType}…`);
        const { url, path } = await uploadMedia(f.file, 'promotions');
        uploadedPaths.push(path);
        URL.revokeObjectURL(f.previewUrl);
        resolved.push({ url, mediaType: f.mediaType });
      }

      setUploadStatus(isEditing ? 'Saving…' : 'Creating…');
      const err = await onSubmit({
        title: values.title.trim(),
        description: values.description.trim(),
        partner_name: values.partner_name.trim(),
        badge_label: values.badge_label.trim(),
        cta_label: values.cta_label.trim(),
        cta_url: values.cta_url.trim() || null,
        expires_at: values.expires_at || null,
        course_id: values.allCourses ? null : courseId,
        image_url: resolved.find(m => m.mediaType === 'image')?.url ?? null,
        video_url: resolved.find(m => m.mediaType === 'video')?.url ?? null,
        media_urls: resolved.map(m => m.url),
      });
      if (err) { await cleanup(); setServerError(err); }
    } catch (e) {
      await cleanup();
      setServerError(e instanceof Error ? e.message : 'Unexpected error.');
    } finally {
      setUploadStatus(null);
    }
  }

  const inputCls = (hasError: boolean) =>
    `w-full px-3 py-2 text-sm border rounded-lg outline-none transition-colors ${hasError ? 'border-red-300 focus:border-red-400 bg-red-50/30' : 'border-gray-200 focus:border-green-500'}`;

  return (
    <AdminCard title={isEditing ? "Edit promotion" : "Add promotion"}>
      <form onSubmit={rhfSubmit(onValid)} noValidate>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div className="col-span-1 sm:col-span-2">
            <FormField label="Title" htmlFor="promo-title" required error={errors.title?.message}>
              <input id="promo-title" placeholder="Complimentary Club Fitting" className={inputCls(!!errors.title)}
                {...register('title', { required: 'Title is required', minLength: { value: 3, message: 'At least 3 characters' }, maxLength: { value: 120, message: 'Max 120 characters' } })} />
            </FormField>
          </div>

          <FormField label="Partner name" htmlFor="promo-partner" required error={errors.partner_name?.message}>
            <input id="promo-partner" placeholder="Aviara Pro Shop" className={inputCls(!!errors.partner_name)}
              {...register('partner_name', { required: 'Partner name is required', minLength: { value: 2, message: 'At least 2 characters' }, maxLength: { value: 100, message: 'Max 100 characters' } })} />
          </FormField>

          <FormField label="Badge label" htmlFor="promo-badge" required error={errors.badge_label?.message}>
            <input id="promo-badge" placeholder="Pro Shop · Aviara" className={inputCls(!!errors.badge_label)}
              {...register('badge_label', { required: 'Badge label is required', maxLength: { value: 60, message: 'Max 60 characters' } })} />
          </FormField>

          <div className="col-span-1 sm:col-span-2">
            <FormField label="Description" htmlFor="promo-description" required error={errors.description?.message}>
              <textarea id="promo-description" rows={3} className={`${inputCls(!!errors.description)} resize-none`}
                {...register('description', { required: 'Description is required', minLength: { value: 10, message: 'At least 10 characters' }, maxLength: { value: 1000, message: 'Max 1000 characters' } })} />
            </FormField>
          </div>

          <FormField label="CTA button label" htmlFor="promo-cta-label" required error={errors.cta_label?.message}>
            <input id="promo-cta-label" className={inputCls(!!errors.cta_label)}
              {...register('cta_label', { required: 'CTA label is required', maxLength: { value: 50, message: 'Max 50 characters' } })} />
          </FormField>

          <FormField label="CTA URL" htmlFor="promo-cta-url" error={errors.cta_url?.message} hint="Leave blank if no link needed">
            <input id="promo-cta-url" type="url" placeholder="https://…" className={inputCls(!!errors.cta_url)}
              {...register('cta_url', {
                validate: v => !v.trim() || (() => { try { new URL(v); return true; } catch { return 'Must be a valid URL'; } })(),
              })} />
          </FormField>

          <FormField label="Expiry date" htmlFor="promo-expires" error={errors.expires_at?.message} hint="Optional — leave blank for no expiry">
            <input id="promo-expires" type="date" className={inputCls(!!errors.expires_at)}
              {...register('expires_at')} />
          </FormField>

          <div className="flex items-center gap-2 mt-1">
            <input id="promo-all-courses" type="checkbox" className="rounded accent-green-600"
              {...register('allCourses')} />
            <label htmlFor="promo-all-courses" className="text-sm text-gray-600 cursor-pointer select-none">
              Show on all courses
            </label>
          </div>

          <div className="col-span-1 sm:col-span-2">
            <MultiMediaUpload
              label="Media (optional)"
              value={mediaFiles}
              onChange={setMediaFiles}
              onRemoveExisting={handleRemoveExisting}
              maxFiles={5}
              disabled={saving}
            />
          </div>
        </div>

        {saving && uploadStatus && (
          <div className="space-y-1.5 mb-3">
            <div className="h-1 w-full bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-green-500 rounded-full animate-pulse w-full" />
            </div>
            <p className="text-xs text-gray-400">{uploadStatus}</p>
          </div>
        )}

        {serverError && (
          <p className="mb-3 text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{serverError}</p>
        )}

        <div className="flex gap-3 justify-end mt-2">
          <AdminButton label="Cancel" onClick={handleCancel} variant="ghost" disabled={saving} />
          <AdminButton
            label={saving ? (uploadStatus ?? '…') : isEditing ? 'Save changes' : 'Create promotion'}
            type="submit"
            variant="gold"
            disabled={saving}
          />
        </div>
      </form>
    </AdminCard>
  );
}

async function uploadMedia(file: File, folder: string): Promise<{ url: string; path: string }> {
  const supabase = createClient();
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'bin';
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('post-media').upload(path, file, { cacheControl: '31536000', upsert: false });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  const { data: { publicUrl } } = supabase.storage.from('post-media').getPublicUrl(path);
  return { url: publicUrl, path };
}
