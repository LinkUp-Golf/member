"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
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
import { formatRelativeTime, capitalizeName } from "@/lib/utils";
import MultiMediaUpload, { type MediaFile } from "@/components/ui/MultiMediaUpload";
import type { AnnouncementType, ModerationStatus } from "@/types";

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
  author: { first_name: string; last_name: string } | null;
}

interface AnnouncementPayload {
  type: string;
  title: string;
  body: string;
  image_url: string | null;
  video_url: string | null;
  media_urls: string[];
}

const TYPE_OPTIONS = [
  { value: "admin_broadcast", label: "Admin broadcast" },
  { value: "focus_linkup", label: "Focus LinkUp reminder" },
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

export default function AdminAnnouncementsPage() {
  const [announcements, setAnnouncements] = useState<AnnouncementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<AnnouncementRow | null>(null);
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
      .from("announcements")
      .select(
        "id, type, title, body, status, published_at, created_at, image_url, video_url, media_urls, author:members!announcements_author_id_fkey(first_name, last_name)",
      )
      .eq("course_id", course?.id)
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

  function openCreate() {
    setShowCreate(true);
    setEditTarget(null);
  }
  function openEdit(a: AnnouncementRow) {
    setEditTarget(a);
    setShowCreate(false);
  }

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
              <span className="text-lg">{TYPE_ICONS[a.type] ?? "📌"}</span>
            </AdminTd>
            <AdminTd>
              <AnnouncementThumb row={a} />
            </AdminTd>
            <AdminTd>
              <p className="font-medium text-gray-900 max-w-xs truncate">
                {a.title}
              </p>
              <p className="text-xs text-gray-400 mt-0.5 max-w-xs line-clamp-2">
                {a.body}
              </p>
            </AdminTd>
            <AdminTd>
              <span className="text-sm text-gray-600">
                {capitalizeName(a.author?.first_name ?? "")}{" "}
                {capitalizeName(a.author?.last_name ?? "")}
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

function AnnouncementForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: AnnouncementRow
  onSubmit: (payload: AnnouncementPayload) => Promise<string | null>
  onCancel: () => void
}) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [body, setBody] = useState(initial?.body ?? '')
  const [type, setType] = useState<string>(initial?.type ?? 'admin_broadcast')
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>(() => initial ? initMediaFiles(initial) : [])
  const [saving, setSaving] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const isEditing = !!initial

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

  async function handleSubmit() {
    if (!title.trim() || !body.trim()) return
    setSaving(true)
    setError(null)
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

      const resolved: { url: string; mediaType: 'image' | 'video' }[] = existing.map(f => ({
        url: f.previewUrl,
        mediaType: f.mediaType,
      }))

      let i = 0
      for (const f of staged) {
        setUploadStatus(
          staged.length > 1
            ? `Uploading ${f.mediaType} (${++i}/${staged.length})…`
            : `Uploading ${f.mediaType}…`
        )
        const { url, path } = await uploadMedia(f.file, 'announcements')
        uploadedPaths.push(path)
        URL.revokeObjectURL(f.previewUrl)
        resolved.push({ url, mediaType: f.mediaType })
      }

      setUploadStatus(isEditing ? 'Saving…' : 'Publishing…')
      const finalImageUrl = resolved.find(m => m.mediaType === 'image')?.url ?? null
      const finalVideoUrl = resolved.find(m => m.mediaType === 'video')?.url ?? null
      const err = await onSubmit({
        type, title, body,
        image_url: finalImageUrl,
        video_url: finalVideoUrl,
        media_urls: resolved.map(m => m.url),
      })
      if (err) {
        await cleanup()
        setError(err)
      }
    } catch (e) {
      await cleanup()
      setError(e instanceof Error ? e.message : 'Unexpected error. Please try again.')
    } finally {
      setSaving(false)
      setUploadStatus(null)
    }
  }

  return (
    <AdminCard title={isEditing ? 'Edit announcement' : 'New community broadcast'}>
      <div className="space-y-4">
        <div>
          <label htmlFor="broadcast-type" className="text-xs text-gray-400 mb-1 block">
            Announcement type
          </label>
          <select
            id="broadcast-type"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-green-500"
            value={type}
            onChange={e => setType(e.target.value)}
          >
            {TYPE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="broadcast-title" className="text-xs text-gray-400 mb-1 block">Title</label>
          <input
            id="broadcast-title"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-green-500"
            placeholder="Announcement headline…"
            value={title}
            onChange={e => setTitle(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="broadcast-body" className="text-xs text-gray-400 mb-1 block">Body</label>
          <textarea
            id="broadcast-body"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-green-500 resize-none"
            rows={4}
            placeholder="Write your message to the community…"
            value={body}
            onChange={e => setBody(e.target.value)}
          />
        </div>
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
            This will be published immediately and visible to all Aviara members.
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
        {error && (
          <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
        )}
        <div className="flex gap-3 justify-end">
          <AdminButton label="Cancel" onClick={handleCancel} variant="ghost" disabled={saving} />
          <AdminButton
            label={saving ? (uploadStatus ?? '…') : isEditing ? 'Save changes' : 'Publish broadcast'}
            onClick={handleSubmit}
            variant="gold"
            disabled={!title.trim() || !body.trim() || saving}
          />
        </div>
      </div>
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
