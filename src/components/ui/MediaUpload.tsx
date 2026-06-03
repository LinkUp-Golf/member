'use client'

import { useState, useRef } from 'react'
import Image from 'next/image'
import { createClient } from '@/lib/supabase'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024  // 10 MB
const MAX_VIDEO_BYTES = 50 * 1024 * 1024  // 50 MB

const ACCEPT = {
  image: 'image/jpeg,image/jpg,image/png,image/webp,image/gif',
  video: 'video/mp4,video/webm,video/quicktime',
}

interface MediaUploadProps {
  label: string
  value: string | null
  onChange: (url: string | null) => void
  /** When provided, skip the immediate upload — call this with the File instead
   *  and show a local blob preview. The parent is responsible for uploading on submit. */
  onFileStaged?: (file: File | null) => void
  mediaType: 'image' | 'video'
  folder: 'announcements' | 'promotions'
}

export default function MediaUpload({
  label,
  value,
  onChange,
  onFileStaged,
  mediaType,
  folder,
}: MediaUploadProps) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const maxBytes = mediaType === 'image' ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES
  const maxLabel = mediaType === 'image' ? '10 MB' : '50 MB'

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (inputRef.current) inputRef.current.value = ''

    if (file.size > maxBytes) {
      setError(`File too large — max ${maxLabel}.`)
      return
    }

    setError(null)

    if (onFileStaged) {
      // Deferred mode: show a local preview, hand the File to the parent.
      if (value?.startsWith('blob:')) URL.revokeObjectURL(value)
      onChange(URL.createObjectURL(file))
      onFileStaged(file)
      return
    }

    setUploading(true)
    try {
      const supabase = createClient()
      const ext = file.name.split('.').pop()?.toLowerCase() ?? 'bin'
      const path = `${folder}/${crypto.randomUUID()}.${ext}`

      const uploadPromise = supabase.storage
        .from('post-media')
        .upload(path, file, { cacheControl: '31536000', upsert: false })

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Upload timed out. Check your connection and try again.')), 30000)
      )

      const { error: uploadError } = await Promise.race([uploadPromise, timeoutPromise])

      if (uploadError) throw new Error(uploadError.message)

      const { data: { publicUrl } } = supabase.storage
        .from('post-media')
        .getPublicUrl(path)

      if (value) {
        const oldPath = storagePath(value)
        if (oldPath) await supabase.storage.from('post-media').remove([oldPath])
      }

      onChange(publicUrl)
    } catch (e) {
      console.error('[MediaUpload] upload error:', e)
      setError(e instanceof Error ? e.message : 'Upload failed. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  async function handleClear() {
    if (!value) return

    if (value.startsWith('blob:')) {
      URL.revokeObjectURL(value)
      onFileStaged?.(null)
      onChange(null)
      return
    }

    const supabase = createClient()
    const path = storagePath(value)
    if (path) await supabase.storage.from('post-media').remove([path])
    onChange(null)
  }

  return (
    <div>
      <label className="text-xs text-gray-400 mb-1.5 block">{label}</label>

      {value ? (
        <div className="relative rounded-xl overflow-hidden border border-gray-200">
          {mediaType === 'image' ? (
            <Image
              src={value}
              alt="Preview"
              width={600}
              height={208}
              className="w-full max-h-52 object-cover"
              unoptimized
            />
          ) : (
            <video
              src={value}
              controls
              playsInline
              className="w-full max-h-52 bg-black"
            />
          )}
          <button
            type="button"
            onClick={handleClear}
            className="absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center text-sm font-semibold text-white transition-colors"
            style={{ background: 'rgba(0,0,0,0.55)' }}
            aria-label={`Remove ${mediaType}`}
          >
            ×
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="w-full border-2 border-dashed border-gray-200 rounded-xl py-6 flex flex-col items-center gap-2 transition-colors disabled:opacity-50 hover:border-green-400 hover:text-green-700"
          style={{ color: 'rgba(0,0,0,0.35)' }}
        >
          {uploading ? (
            <>
              <div className="w-5 h-5 rounded-full border-2 border-current border-t-transparent animate-spin" />
              <span className="text-xs">Uploading…</span>
            </>
          ) : (
            <>
              <UploadIcon />
              <span className="text-xs font-medium">
                Click to upload {mediaType}
              </span>
              <span className="text-xs opacity-50">Max {maxLabel}</span>
            </>
          )}
        </button>
      )}

      {error && (
        <p className="mt-1 text-xs text-red-500">{error}</p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT[mediaType]}
        className="hidden"
        onChange={handleChange}
      />
    </div>
  )
}

// Extract the bucket-relative path from a Supabase Storage public URL.
// e.g. https://xxx.supabase.co/storage/v1/object/public/post-media/announcements/abc.jpg
//   →  announcements/abc.jpg
function storagePath(publicUrl: string): string | null {
  const marker = '/object/public/post-media/'
  const idx = publicUrl.indexOf(marker)
  return idx === -1 ? null : publicUrl.slice(idx + marker.length)
}

function UploadIcon() {
  return (
    <svg
      className="w-6 h-6"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
      />
    </svg>
  )
}
