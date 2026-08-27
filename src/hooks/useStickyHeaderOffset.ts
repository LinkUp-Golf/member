'use client'

import { useEffect, useState } from 'react'

/**
 * The height in px of the page's sticky header (`.top-bar`, rendered by
 * AppShell), so a second sticky element can dock directly beneath it rather
 * than behind it.
 *
 * Measured rather than hardcoded because the header's height depends on
 * whether the page passes a description and what it puts in `end`. Returns 0
 * until the first measurement lands — one frame docked at the very top, which
 * is only visible if the page is already scrolled on mount.
 */
export function useStickyHeaderOffset(): number {
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    // First in document order is AppShell's header; a page-level `.top-bar`
    // further down belongs to a different step and never coexists with one
    // that needs an offset.
    const bar = document.querySelector('.top-bar')
    if (!bar) return

    const measure = () => setOffset(bar.getBoundingClientRect().height)
    measure()

    const observer = new ResizeObserver(measure)
    observer.observe(bar)
    return () => observer.disconnect()
  }, [])

  return offset
}
