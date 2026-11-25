'use client'

// Reloads a page that's still running the code of an earlier deploy.
//
// The App Router never reloads between screens: a tab or installed app left
// open across a deploy keeps running the JavaScript it first loaded, however
// long ago that was, until someone reloads by hand. That's how a fix can be
// live and still not reach a member — an admin's desktop tab kept loading
// their profile the old way, greeting them as "Guest" with no Admin entry,
// until a hard refresh.
//
// So: whenever the app comes back into view (and every 15 minutes while it's
// on screen), ask /api/version which build is deployed. If it isn't the one
// this page was built from, reload — but only at the next screen change, so
// nobody loses a half-typed message to it. Once per deployed build at most,
// so a mismatch that a reload can't cure (a build without a commit hash)
// can't become a loop.

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

const LOADED_BUILD = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? null
const CHECK_EVERY_MS = 15 * 60_000
const MIN_GAP_MS = 60_000
const RELOADED_KEY = 'linkup-reloaded-for-build'

export default function UpdateWatcher() {
  const pathname = usePathname()
  const staleFor = useRef<string | null>(null)
  const lastCheck = useRef(0)
  const firstPath = useRef(true)

  useEffect(() => {
    // No commit hash (local dev, a non-Vercel build): nothing to compare.
    if (!LOADED_BUILD) return

    const check = async () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastCheck.current < MIN_GAP_MS) return
      lastCheck.current = Date.now()
      try {
        const res = await fetch('/api/version', { cache: 'no-store' })
        if (!res.ok) return
        const { build } = (await res.json()) as { build: string | null }
        if (build && build !== LOADED_BUILD) staleFor.current = build
      } catch {
        // Offline or a blip: try again next time.
      }
    }

    void check()
    const timer = setInterval(check, CHECK_EVERY_MS)
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
    }
  }, [])

  useEffect(() => {
    // The first render isn't a screen change.
    if (firstPath.current) { firstPath.current = false; return }
    const build = staleFor.current
    if (!build) return
    try {
      if (sessionStorage.getItem(RELOADED_KEY) === build) return
      sessionStorage.setItem(RELOADED_KEY, build)
    } catch {
      // Storage blocked: reload anyway; the new code won't be stale.
    }
    window.location.reload()
  }, [pathname])

  return null
}
