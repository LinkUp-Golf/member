'use client'

import { useRef, useState } from 'react'

const ACCEPT = 'image/jpeg,image/jpg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime'
const MAX_IMAGE = 10 * 1024 * 1024   // 10 MB
const MAX_VIDEO = 50 * 1024 * 1024   // 50 MB

export interface MediaFile {
  id: string
  mediaType: 'image' | 'video'
  /** Blob URL for staged files; storage public URL for existing ones. */
  previewUrl: string
  /** Present only for staged (not yet uploaded) files. */
  file?: File
}

interface MultiMediaUploadProps {
  label?: string
  value: MediaFile[]
  onChange: (files: MediaFile[]) => void
  /** Called when an already-uploaded file is removed so the parent can delete it from storage. */
  onRemoveExisting?: (url: string) => void
  maxFiles?: number
  disabled?: boolean
}

export default function MultiMediaUpload({
  label = 'Media',
  value,
  onChange,
  onRemoveExisting,
  maxFiles = 5,
  disabled = false,
}: MultiMediaUploadProps) {
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function processFiles(fileList: FileList | null) {
    if (!fileList || disabled) return
    setError(null)

    const incoming = Array.from(fileList)
    const slots = maxFiles - value.length

    if (incoming.length > slots) {
      setError(`Only ${slots} more file${slots === 1 ? '' : 's'} allowed (max ${maxFiles}).`)
      return
    }

    const toAdd: MediaFile[] = []

    for (const file of incoming) {
      const isImage = file.type.startsWith('image/')
      const isVideo = file.type.startsWith('video/')

      if (!isImage && !isVideo) {
        setError(`"${file.name}" is not a supported type. Use images or videos.`)
        return
      }

      const limit = isImage ? MAX_IMAGE : MAX_VIDEO
      const limitLabel = isImage ? '10 MB' : '50 MB'
      if (file.size > limit) {
        setError(`"${file.name}" exceeds the ${limitLabel} limit.`)
        return
      }

      toAdd.push({
        id: crypto.randomUUID(),
        mediaType: isImage ? 'image' : 'video',
        previewUrl: URL.createObjectURL(file),
        file,
      })
    }

    onChange([...value, ...toAdd])
    if (inputRef.current) inputRef.current.value = ''
  }

  function remove(id: string) {
    const target = value.find(f => f.id === id)
    if (!target) return
    if (target.file) {
      URL.revokeObjectURL(target.previewUrl)
    } else {
      onRemoveExisting?.(target.previewUrl)
    }
    onChange(value.filter(f => f.id !== id))
  }

  const canAdd = value.length < maxFiles && !disabled

  return (
    <div>
      {label && (
        <label className="text-xs text-gray-400 mb-1.5 block">{label}</label>
      )}

      {value.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {value.map(f => (
            <div
              key={f.id}
              className="relative w-20 h-20 rounded-xl overflow-hidden border border-gray-200 bg-black flex-shrink-0"
            >
              {f.mediaType === 'image' ? (
                <img src={f.previewUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <video src={f.previewUrl} className="w-full h-full object-cover" muted playsInline />
              )}
              <span className="absolute bottom-1 left-1 text-[9px] bg-black/55 text-white px-1 py-px rounded leading-none">
                {f.mediaType === 'image' ? 'IMG' : 'VID'}
              </span>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => remove(f.id)}
                  className="absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold text-white"
                  style={{ background: 'rgba(0,0,0,0.6)' }}
                  aria-label="Remove file"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {canAdd && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); processFiles(e.dataTransfer.files) }}
          className={`w-full border-2 border-dashed rounded-xl py-6 flex flex-col items-center gap-1.5 transition-colors ${
            dragging
              ? 'border-green-400 bg-green-50 text-green-700'
              : 'border-gray-200 text-gray-400 hover:border-green-400 hover:text-green-700'
          }`}
        >
          <UploadIcon />
          <span className="text-xs font-medium">
            {value.length === 0 ? 'Click or drag to upload images & videos' : 'Add more files'}
          </span>
          <span className="text-xs opacity-50">Images ≤ 10 MB · Videos ≤ 50 MB</span>
          <span className="text-xs opacity-35">{value.length} / {maxFiles}</span>
        </button>
      )}

      {error && (
        <p className="mt-1.5 text-xs text-red-500">{error}</p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        onChange={e => processFiles(e.target.files)}
      />
    </div>
  )
}

function UploadIcon() {
  return (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
    </svg>
  )
}
