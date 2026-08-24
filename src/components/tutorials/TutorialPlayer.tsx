'use client'

// Watching a video guide, wherever it's offered from.
//
// Three pieces over one catalogue (@/lib/tutorials): the modal that plays a
// video, a text link for the screen a video is about, and a card for the Guides
// index. All three so a guide is offered identically everywhere and a video can
// be swapped without hunting for players.
//
// It plays in a modal rather than opening the file in a new tab: this is a PWA,
// and navigating away loses the screen the viewer was mid-way through — which is
// usually the screen the video is explaining.
//
// Nothing is fetched until play is pressed. These are 25–50 MB screen
// recordings, so preload="none" is doing real work here, and the size is on
// screen before the tap for anyone on cellular.

import { useCallback, useEffect, useState } from 'react'
import { PlayCircle, X } from 'lucide-react'
import { getTutorial, type Tutorial } from '@/lib/tutorials'

/** Resolve either form callers use, so neither has to handle "missing". */
function resolve(t: Tutorial | string | undefined): Tutorial | undefined {
  return typeof t === 'string' ? getTutorial(t) : t
}

export function TutorialModal({
  tutorial,
  onClose,
}: {
  tutorial: Tutorial
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label={tutorial.title}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-100">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-gray-900">{tutorial.title}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{tutorial.description}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="focus-ring flex-shrink-0 p-1 rounded-lg text-gray-400 hover:text-gray-700"
          >
            <X className="w-5 h-5" strokeWidth={2} />
          </button>
        </div>

        {/* Black behind the video so letterboxing on a portrait phone reads as
            deliberate rather than as a broken layout. */}
        <div className="bg-black">
          <video
            src={tutorial.url}
            controls
            playsInline
            // Nothing downloads until they press play — see the note above.
            preload="none"
            className="w-full max-h-[70vh] object-contain block"
          />
        </div>

        {tutorial.sizeMb != null && (
          <p className="px-5 py-3 text-[11px] text-gray-400">
            About {tutorial.sizeMb} MB — worth waiting for Wi-Fi if you&apos;re on data.
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * A quiet inline link to one guide, for the screen that guide is about. Renders
 * nothing at all when the id doesn't resolve, so a retired video can't leave a
 * dead control behind.
 */
export function TutorialLink({
  tutorial,
  label,
  className,
}: {
  tutorial: Tutorial | string
  /** Overrides "Watch: <title>" where the surrounding copy reads better. */
  label?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const resolved = resolve(tutorial)
  const close = useCallback(() => setOpen(false), [])

  if (!resolved) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ??
          'focus-ring inline-flex items-center gap-1.5 text-xs font-semibold text-green-800 hover:text-green-900'
        }
      >
        <PlayCircle className="w-4 h-4 flex-shrink-0" strokeWidth={1.9} />
        {label ?? `Watch: ${resolved.title.toLowerCase()}`}
      </button>
      {open && <TutorialModal tutorial={resolved} onClose={close} />}
    </>
  )
}

/** A guide as a row on the Guides index. */
export function TutorialCard({ tutorial }: { tutorial: Tutorial }) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="focus-ring w-full text-left flex items-start gap-3 px-4 sm:px-5 py-4 hover:bg-gray-50 transition-colors"
      >
        <span className="flex-shrink-0 w-9 h-9 rounded-full bg-green-50 flex items-center justify-center">
          <PlayCircle className="w-5 h-5 text-green-800" strokeWidth={1.9} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-gray-900">{tutorial.title}</span>
          <span className="block text-xs text-gray-500 mt-0.5 leading-relaxed">{tutorial.description}</span>
          {tutorial.sizeMb != null && (
            <span className="block text-[11px] text-gray-400 mt-1">About {tutorial.sizeMb} MB</span>
          )}
        </span>
      </button>
      {open && <TutorialModal tutorial={tutorial} onClose={close} />}
    </>
  )
}
