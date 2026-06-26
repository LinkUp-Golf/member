"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { useForm, Controller } from "react-hook-form";
import Select from "@/components/ui/Select";
import { createClient } from "@/lib/supabase";
import { COURSE_SLUGS } from "@/lib/ghl/tags";
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
import { formatRelativeTime } from "@/lib/utils";
import MultiMediaUpload, { type MediaFile } from "@/components/ui/MultiMediaUpload";
import { INDUSTRY_CATEGORIES } from "@/types";
import type { AnnouncementType, ModerationStatus } from "@/types";
import { FEATURES } from "@/lib/features";

interface AnnouncementRow {
  id: string;
  type: AnnouncementType;
  title: string;
  body: string;
  status: ModerationStatus;
  published_at: string | null;
  created_at: string;
  image_url: string | null;
  video_url: string | null;
  media_urls: string[];
  focus_linkup_categories: string[];
  is_pinned: boolean;
  author: { first_name: string; last_name: string } | null;
}

interface AnnouncementPayload {
  type: string;
  title: string;
  body: string;
  image_url: string | null;
  video_url: string | null;
  media_urls: string[];
  focus_linkup_categories: string[];
}

const TYPE_OPTIONS = [
  { value: "admin_broadcast", label: "Admin broadcast" },
  ...(FEATURES.FOCUS_LINKUPS ? [{ value: "focus_linkup", label: "Focus LinkUp reminder" }] : []),
  { value: "new_member", label: "New member welcome" },
];

const TYPE_ICONS: Record<string, string> = {
  new_member: "👋",
  booking: "⛳",
  visiting_member: "✈️",
  member_event: "📅",
  admin_broadcast: "📢",
  focus_linkup: "🎯",
};

const MAX_PINNED = 5

export default function AdminAnnouncementsPage() {
  const [announcements, setAnnouncements] = useState<AnnouncementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<AnnouncementRow | null>(null);
  const [courseId, setCourseId] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);

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

    const { data } = await supabase
      .from("announcements")
      .select(
        "id, type, title, body, status, published_at, created_at, image_url, video_url, media_urls, focus_linkup_categories, is_pinned, author:members!announcements_author_id_fkey(first_name, last_name)",
      )
      .in("course_id", courseIds)
      .order("created_at", { ascending: false })
      .limit(50);
    setAnnouncements((data ?? []) as unknown as AnnouncementRow[]);
    setLoading(false);
  }

  async function handleCreate(
    payload: AnnouncementPayload,
  ): Promise<string | null> {
    const res = await fetch("/api/admin/announcements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ course_id: courseId, ...payload }),
    });
    const json = await res.json();
    if (!res.ok)
      return json.error?.message ?? json.error ?? "Failed to publish";
    await loadData();
    setShowCreate(false);
    return null;
  }

  async function handleUpdate(
    id: string,
    payload: AnnouncementPayload,
  ): Promise<string | null> {
    const res = await fetch(`/api/admin/announcements/${id}`, {
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
    if (!confirm("Delete this announcement?")) return;
    const res = await fetch(`/api/admin/announcements/${id}`, {
      method: "DELETE",
    });
    if (res.ok) await loadData();
  }

  async function togglePin(a: AnnouncementRow) {
    const next = !a.is_pinned;
    // Optimistic update
    setAnnouncements(prev => prev.map(r => r.id === a.id ? { ...r, is_pinned: next } : r));
    const res = await fetch(`/api/admin/announcements/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_pinned: next }),
    });
    if (!res.ok) {
      // Revert
      setAnnouncements(prev => prev.map(r => r.id === a.id ? { ...r, is_pinned: a.is_pinned } : r));
      const json = await res.json().catch(() => ({}));
      setPinError(json.error ?? "Failed to update pin.");
      setTimeout(() => setPinError(null), 5000);
    }
  }

  function openCreate() {
    setShowCreate(true);
    setEditTarget(null);
  }
  function openEdit(a: AnnouncementRow) {
    setEditTarget(a);
    setShowCreate(false);
  }

  const pinnedCount = announcements.filter(a => a.is_pinned).length;
  const pinMaxed = pinnedCount >= MAX_PINNED;

  return (
    <div className="p-4 sm:p-8">
      <AdminPageHeader
        title="Announcements"
        description="Broadcast messages to the community"
        action={
          <AdminButton
            label="+ New broadcast"
            onClick={openCreate}
            variant="gold"
          />
        }
      />

      {/* Pin quota indicator */}
      {!loading && announcements.length > 0 && (
        <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium mb-4 ${
          pinMaxed
            ? 'bg-amber-50 text-amber-700 border border-amber-200'
            : 'bg-gray-50 text-gray-500 border border-gray-100'
        }`}>
          <span>📌</span>
          <span>{pinnedCount} / {MAX_PINNED} pinned</span>
          {pinMaxed && <span className="font-semibold">— max reached</span>}
        </div>
      )}

      {/* Pin error toast */}
      {pinError && (
        <div className="flex items-center gap-2 mb-4 px-4 py-2.5 rounded-lg bg-red-50 border border-red-100 text-sm text-red-600">
          <span>⚠️</span>
          <span>{pinError}</span>
          <button onClick={() => setPinError(null)} className="ml-auto text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {showCreate && !editTarget && (
        <div className="mb-6">
          <AnnouncementForm
            onSubmit={handleCreate}
            onCancel={() => setShowCreate(false)}
          />
        </div>
      )}

      {editTarget && (
        <div className="mb-6">
          <AnnouncementForm
            initial={editTarget}
            onSubmit={(p) => handleUpdate(editTarget.id, p)}
            onCancel={() => setEditTarget(null)}
          />
        </div>
      )}

      <AdminTable
        headers={["Type", "Media", "Title", "Author", "Status", "Date", "Actions"]}
        empty={
          loading
            ? "Loading…"
            : announcements.length === 0
              ? "No announcements yet."
              : undefined
        }
      >
        {announcements.map((a) => (
          <AdminTr key={a.id}>
            <AdminTd>
              <span className="text-lg">{TYPE_ICONS[a.type] ?? "📢"}</span>
            </AdminTd>
            <AdminTd>
              <AnnouncementThumb row={a} />
            </AdminTd>
            <AdminTd>
              <div className="flex items-center gap-1.5 mb-0.5">
                {a.is_pinned && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200 leading-none">
                    📌 Pinned
                  </span>
                )}
                <p className="font-medium text-gray-900 max-w-xs truncate">
                  {a.title}
                </p>
              </div>
              <p className="text-xs text-gray-400 max-w-xs line-clamp-2">
                {a.body}
              </p>
            </AdminTd>
            <AdminTd>
              <span className="text-sm text-gray-600 capitalize">
                {a.author?.first_name ?? ""}{" "}
                {a.author?.last_name ?? ""}
              </span>
            </AdminTd>
            <AdminTd>
              <Badge
                label={
                  a.status === "published"
                    ? "Published"
                    : a.status === "pending_review"
                      ? "Pending"
                      : "Rejected"
                }
                colour={
                  a.status === "published"
                    ? "green"
                    : a.status === "pending_review"
                      ? "yellow"
                      : "red"
                }
              />
            </AdminTd>
            <AdminTd>
              <span className="text-xs text-gray-400">
                {formatRelativeTime(a.published_at ?? a.created_at)}
              </span>
            </AdminTd>
            <AdminTd>
              <div className="flex gap-1.5">
                <AdminButton
                  label={a.is_pinned ? "📌 Unpin" : "Pin"}
                  onClick={() => togglePin(a)}
                  variant={a.is_pinned ? "warning" : "ghost"}
                  size="sm"
                  disabled={!a.is_pinned && pinMaxed}
                />
                <AdminButton
                  label="Edit"
                  onClick={() => openEdit(a)}
                  variant="ghost"
                  size="sm"
                />
                <AdminButton
                  label="Delete"
                  onClick={() => handleDelete(a.id)}
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

function initMediaFiles(row: AnnouncementRow): MediaFile[] {
  // Prefer the full media_urls array; fall back to legacy single fields for old records.
  if (row.media_urls?.length) {
    return row.media_urls.map(url => ({
      id: crypto.randomUUID(),
      mediaType: mediaTypeFromUrl(url),
      previewUrl: url,
    }))
  }
  const files: MediaFile[] = []
  if (row.image_url) files.push({ id: crypto.randomUUID(), mediaType: 'image', previewUrl: row.image_url })
  if (row.video_url) files.push({ id: crypto.randomUUID(), mediaType: 'video', previewUrl: row.video_url })
  return files
}

function mediaTypeFromUrl(url: string): 'image' | 'video' {
  const ext = url.split('?')[0]?.split('.').pop()?.toLowerCase() ?? ''
  return ['mp4', 'webm', 'mov', 'quicktime'].includes(ext) ? 'video' : 'image'
}

interface AnnouncementFormValues {
  type: string
  title: string
  body: string
}

function AnnouncementForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: AnnouncementRow
  onSubmit: (payload: AnnouncementPayload) => Promise<string | null>
  onCancel: () => void
}) {
  const {
    register,
    handleSubmit: rhfSubmit,
    watch,
    control,
    formState: { errors, isSubmitting },
    setError: _setFieldError,
  } = useForm<AnnouncementFormValues>({
    defaultValues: {
      type: initial?.type ?? 'admin_broadcast',
      title: initial?.title ?? '',
      body: initial?.body ?? '',
    },
  })

  const watchedType = watch('type')
  const [focusCategories, setFocusCategories] = useState<string[]>(
    () => initial?.focus_linkup_categories ?? []
  )
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>(() => initial ? initMediaFiles(initial) : [])
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)

  const isEditing = !!initial
  const saving = isSubmitting

  function toggleFocusCategory(cat: string) {
    setFocusCategories(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    )
  }

  function handleCancel() {
    mediaFiles.forEach(f => { if (f.file) URL.revokeObjectURL(f.previewUrl) })
    onCancel()
  }

  async function handleRemoveExisting(url: string) {
    const supabase = createClient()
    const marker = '/object/public/post-media/'
    const idx = url.indexOf(marker)
    if (idx !== -1) await supabase.storage.from('post-media').remove([url.slice(idx + marker.length)])
  }

  async function onValid(values: AnnouncementFormValues) {
    setServerError(null)
    setUploadStatus(null)

    const uploadedPaths: string[] = []
    async function cleanup() {
      if (uploadedPaths.length === 0) return
      const supabase = createClient()
      await supabase.storage.from('post-media').remove(uploadedPaths)
    }

    try {
      const staged = mediaFiles.filter((f): f is MediaFile & { file: File } => !!f.file)
      const existing = mediaFiles.filter(f => !f.file)
      const resolved: { url: string; mediaType: 'image' | 'video' }[] = existing.map(f => ({ url: f.previewUrl, mediaType: f.mediaType }))

      let i = 0
      for (const f of staged) {
        setUploadStatus(staged.length > 1 ? `Uploading ${f.mediaType} (${++i}/${staged.length})…` : `Uploading ${f.mediaType}…`)
        const { url, path } = await uploadMedia(f.file, 'announcements')
        uploadedPaths.push(path)
        URL.revokeObjectURL(f.previewUrl)
        resolved.push({ url, mediaType: f.mediaType })
      }

      setUploadStatus(isEditing ? 'Saving…' : 'Publishing…')
      const err = await onSubmit({
        type: values.type,
        title: values.title.trim(),
        body: values.body.trim(),
        image_url: resolved.find(m => m.mediaType === 'image')?.url ?? null,
        video_url: resolved.find(m => m.mediaType === 'video')?.url ?? null,
        media_urls: resolved.map(m => m.url),
        focus_linkup_categories: values.type === 'focus_linkup' ? focusCategories : [],
      })
      if (err) { await cleanup(); setServerError(err) }
    } catch (e) {
      await cleanup()
      setServerError(e instanceof Error ? e.message : 'Unexpected error. Please try again.')
    } finally {
      setUploadStatus(null)
    }
  }

  const inputCls = (hasError: boolean) =>
    `w-full px-3 py-2 text-sm border rounded-lg outline-none transition-colors ${hasError ? 'border-red-300 focus:border-red-400 bg-red-50/30' : 'border-gray-200 focus:border-green-500'}`

  return (
    <AdminCard title={isEditing ? 'Edit announcement' : 'New community broadcast'}>
      <form onSubmit={rhfSubmit(onValid)} noValidate>
        <div className="space-y-4">
          <FormField label="Announcement type" htmlFor="broadcast-type" required>
            <Controller
              name="type"
              control={control}
              rules={{ required: true }}
              render={({ field }) => (
                <Select
                  id="broadcast-type"
                  options={TYPE_OPTIONS.map(t => ({ value: t.value, label: t.label }))}
                  value={field.value}
                  onChange={field.onChange}
                  triggerClassName={inputCls(false) + ' flex items-center justify-between gap-2 text-left'}
                />
              )}
            />
          </FormField>

          {watchedType === 'focus_linkup' && (
            <FormField label="Target audience" htmlFor="focus-cats">
              <p className="text-xs text-gray-400 mb-2">
                Select the Focus LinkUp categories to notify. Leave empty to send to all members.
              </p>
              <div className="flex flex-wrap gap-2">
                {INDUSTRY_CATEGORIES.map(cat => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => toggleFocusCategory(cat)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                      focusCategories.includes(cat)
                        ? 'bg-green-900 text-white border-green-900'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
              {focusCategories.length === 0 && (
                <p className="text-xs text-amber-600 mt-1.5">No categories selected — announcement will reach all members.</p>
              )}
            </FormField>
          )}

          <FormField label="Title" htmlFor="broadcast-title" required error={errors.title?.message}>
            <input
              id="broadcast-title"
              placeholder="Announcement headline…"
              className={inputCls(!!errors.title)}
              {...register('title', {
                required: 'Title is required',
                minLength: { value: 3, message: 'At least 3 characters' },
                maxLength: { value: 120, message: 'Max 120 characters' },
              })}
            />
          </FormField>

          <FormField label="Body" htmlFor="broadcast-body" required error={errors.body?.message}>
            <textarea
              id="broadcast-body"
              rows={4}
              placeholder="Write your message to the community…"
              className={`${inputCls(!!errors.body)} resize-none`}
              {...register('body', {
                required: 'Body is required',
                minLength: { value: 10, message: 'At least 10 characters' },
                maxLength: { value: 3000, message: 'Max 3000 characters' },
              })}
            />
          </FormField>

          <MultiMediaUpload
            label="Media (optional)"
            value={mediaFiles}
            onChange={setMediaFiles}
            onRemoveExisting={handleRemoveExisting}
            maxFiles={5}
            disabled={saving}
          />

          {!isEditing && (
            <p className="text-xs text-gray-400">
              {watchedType === 'focus_linkup' && focusCategories.length > 0
                ? `Only members subscribed to: ${focusCategories.join(', ')} will see this.`
                : 'This will be published immediately and visible to all Aviara members.'}
            </p>
          )}

          {saving && uploadStatus && (
            <div className="space-y-1.5">
              <div className="h-1 w-full bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-green-500 rounded-full animate-pulse w-full" />
              </div>
              <p className="text-xs text-gray-400">{uploadStatus}</p>
            </div>
          )}

          {serverError && (
            <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{serverError}</p>
          )}

          <div className="flex gap-3 justify-end">
            <AdminButton label="Cancel" onClick={handleCancel} variant="ghost" disabled={saving} />
            <AdminButton
              label={saving ? (uploadStatus ?? '…') : isEditing ? 'Save changes' : 'Publish broadcast'}
              type="submit"
              variant="gold"
              disabled={saving}
            />
          </div>
        </div>
      </form>
    </AdminCard>
  )
}

function AnnouncementThumb({ row }: { row: AnnouncementRow }) {
  const url = row.media_urls?.[0] ?? row.image_url ?? row.video_url
  if (!url) return <span className="text-gray-300 text-xs">—</span>
  const ext = url.split('?')[0]?.split('.').pop()?.toLowerCase() ?? ''
  const isVideo = ['mp4', 'webm', 'mov', 'quicktime'].includes(ext)
  const count = row.media_urls?.length
    ?? ((row.image_url ? 1 : 0) + (row.video_url ? 1 : 0))
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
  )
}

async function uploadMedia(file: File, folder: string): Promise<{ url: string; path: string }> {
  const supabase = createClient()
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'bin'
  const path = `${folder}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage
    .from('post-media')
    .upload(path, file, { cacheControl: '31536000', upsert: false })
  if (error) throw new Error(`Upload failed: ${error.message}`)
  const { data: { publicUrl } } = supabase.storage.from('post-media').getPublicUrl(path)
  return { url: publicUrl, path }
}
