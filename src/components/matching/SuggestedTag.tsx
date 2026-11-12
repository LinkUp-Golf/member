'use client'

// "Suggested" beside a member the LinkUp team recommended to this member.
// Hovering it with a mouse shows why; on a phone, a tap does the same (a
// hover-only tooltip is invisible on the device most members use, see
// InfoBubble). A second tap, a tap anywhere else, or Escape closes it.
//
// The explanation is portalled to <body> and placed against the tag, because
// the member list sits in a card that clips its overflow.

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Sparkles } from 'lucide-react'
import type { Recommendation } from '@/hooks/useRecommendations'

const WIDTH = 272 // px — the popover's width, clamped to the screen below
const GAP = 6

export default function SuggestedTag({ recommendation }: { recommendation: Recommendation }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const popover = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<number | undefined>(undefined)
  // A mouse already opened it by hovering, so its click shouldn't close it.
  const lastPointer = useRef<string>('')
  const id = useId()

  const place = useCallback(() => {
    const r = button.current?.getBoundingClientRect()
    if (!r) return
    const vw = document.documentElement.clientWidth
    const width = Math.min(WIDTH, vw - 24)
    // Right edges aligned, kept 12px inside the screen on either side.
    const left = Math.min(Math.max(12, r.right - width), vw - width - 12)
    setPos({ top: r.bottom + GAP, left, width })
  }, [])

  const show = useCallback(() => {
    window.clearTimeout(closeTimer.current)
    place()
    setOpen(true)
  }, [place])

  // A short grace period, so the pointer can cross the gap to the popover.
  const hideSoon = useCallback(() => {
    window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => setOpen(false), 150)
  }, [])

  useEffect(() => () => window.clearTimeout(closeTimer.current), [])

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node
      if (!button.current?.contains(t) && !popover.current?.contains(t)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    // Placed once against the tag; a scroll would leave it floating elsewhere.
    function onMove() { setOpen(false) }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [open])

  const mouseOnly = (fn: () => void) => (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') fn()
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        onPointerEnter={mouseOnly(show)}
        onPointerLeave={mouseOnly(hideSoon)}
        onPointerDown={e => { lastPointer.current = e.pointerType }}
        onClick={e => {
          // It sits on a row that links to the profile.
          e.preventDefault()
          e.stopPropagation()
          if (open && lastPointer.current !== 'mouse') setOpen(false)
          else show()
        }}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={`Suggested by the LinkUp team. Why ${recommendation.member.firstName || 'they'} and you?`}
        className="focus-ring inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
        style={{ color: 'var(--color-green-700)', background: 'rgba(133,187,101,0.16)' }}
      >
        <Sparkles className="w-3 h-3" strokeWidth={2.25} aria-hidden />
        Suggested
      </button>

      {open && pos && createPortal(
        <div
          ref={popover}
          id={id}
          role="tooltip"
          onPointerEnter={mouseOnly(show)}
          onPointerLeave={mouseOnly(hideSoon)}
          className="fixed z-[80] rounded-xl bg-green-900 text-white text-xs leading-relaxed px-3.5 py-3 shadow-lg"
          style={{ top: pos.top, left: pos.left, width: pos.width }}
        >
          <p className="font-display text-base leading-none" style={{ color: 'var(--color-gold)' }}>Why you two</p>
          <p className="mt-1.5 text-white/90">
            {recommendation.note || 'The LinkUp team thinks you two should play a round together.'}
          </p>
          {recommendation.shared.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {recommendation.shared.map(s => (
                <span key={s} className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-white/80">{s}</span>
              ))}
            </div>
          )}
          <p className="mt-2 text-[10px] text-white/45">Recommended by the LinkUp team</p>
        </div>,
        document.body,
      )}
    </>
  )
}
