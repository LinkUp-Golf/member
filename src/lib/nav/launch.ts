// ============================================================
// Where the installed app opens.
//
// public/manifest.json's start_url has been /book since 2026-08-14, but a
// phone copies the manifest when the app is added to its home screen, and
// iOS never refreshes that copy. Every icon added before then still opens
// /home. Nothing the server sends can tell a launch from a member tapping
// Home in the menu, so the browser decides: the installed app's first page
// load, arriving at /home by a fresh navigation, is a launch from an old
// icon, and goes to Book.
//
// Left alone: Home reached from the menu (a client-side navigation, not a
// page load), a reload on Home (the member chose to be there), back/forward,
// and /home opened in an ordinary browser tab (a link someone followed).
// ============================================================

import { DEFAULT_LANDING_PATH } from '@/lib/constants'

export const OLD_START_PATH = '/home'

export interface LaunchInfo {
  /** Path of the URL the document was loaded at (not the current one). */
  initialPath: string
  /** PerformanceNavigationTiming.type: navigate | reload | back_forward | prerender. */
  navigationType: string | undefined
  /** Running as an installed app (display-mode: standalone). */
  standalone: boolean
}

/** The path to replace a launch with, or null to stay where it is. */
export function launchRedirect({ initialPath, navigationType, standalone }: LaunchInfo): string | null {
  if (!standalone) return null
  if (navigationType === 'reload' || navigationType === 'back_forward') return null
  const path = initialPath.length > 1 ? initialPath.replace(/\/+$/, '') : initialPath
  return path === OLD_START_PATH ? DEFAULT_LANDING_PATH : null
}
