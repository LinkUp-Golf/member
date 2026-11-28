'use client'

// ============================================================
// Sends an installed app launched from a pre-August home-screen
// icon (start_url /home) to Book. The rule is launchRedirect in
// @/lib/nav/launch; this only gathers what the browser knows.
// Mounted once in the (app) layout; renders nothing.
// ============================================================

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { launchRedirect } from '@/lib/nav/launch'

// One decision per document: the layout can remount, the launch can't recur.
let decided = false

function isStandalone(): boolean {
  try {
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true
  } catch {}
  return (navigator as Navigator & { standalone?: boolean }).standalone === true
}

export default function LaunchRedirect() {
  const router = useRouter()

  useEffect(() => {
    if (decided) return
    decided = true

    const entry = performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined
    let initialPath = window.location.pathname
    try {
      if (entry?.name) initialPath = new URL(entry.name).pathname
    } catch {}

    // Only if the page is still where it loaded — a member who has already
    // moved on mustn't be pulled back.
    if (window.location.pathname !== initialPath) return

    const to = launchRedirect({ initialPath, navigationType: entry?.type, standalone: isStandalone() })
    if (to) router.replace(to)
  }, [router])

  return null
}
