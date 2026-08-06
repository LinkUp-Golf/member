'use client'

// A small ⓘ next to a label that explains what the field is for.
//
// Tap to toggle rather than hover to reveal: this is a phone-first PWA, and a
// hover-only tooltip is invisible on the device most members use. The `title`
// attribute is still set so a desktop pointer gets the native tooltip too,
// without needing the tap.

import { useState, useRef, useEffect, useId } from 'react'
import { Info } from 'lucide-react'

export default function InfoBubble({ text, label }: {
  text: string
  /** Screen-reader name for the button. Defaults to something generic — pass the field name where there's more than one on screen. */
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLSpanElement>(null)
  const id = useId()

  // Dismiss on outside tap or Escape. Only bound while open — a listener per
  // bubble on every render would be a lot of no-op work on a form full of them.
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent | TouchEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <span ref={wrapRef} className="relative inline-flex align-middle">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title={text}
        aria-label={label ? `About ${label}` : 'More information'}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        className="text-green-900/35 hover:text-green-900/70 transition-colors focus-ring rounded-full"
      >
        <Info className="w-3.5 h-3.5" strokeWidth={2.5} aria-hidden="true" />
      </button>

      {open && (
        <span
          id={id}
          role="tooltip"
          // Absolute so opening it doesn't push the field below it down the
          // page. left-0 with a viewport-capped width keeps it on screen on a
          // narrow phone instead of centring off the edge.
          className="absolute left-0 top-full mt-1.5 z-20 w-[min(16rem,calc(100vw-3rem))] rounded-xl bg-green-900 text-white text-xs leading-relaxed normal-case tracking-normal px-3 py-2 shadow-lg"
        >
          {text}
        </span>
      )}
    </span>
  )
}
