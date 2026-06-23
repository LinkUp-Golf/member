// ============================================================
// Client-side feature flag reader.
// Middleware evaluates flags (including Vercel toolbar overrides)
// and stamps plain cookies — e.g. ff_focus_linkups=1.
// This module reads those cookies synchronously so they work in
// 'use client' components without async calls.
//
// For server-side evaluation with full override support, import
// flag functions directly from @/flags instead.
// ============================================================

function readFlagCookie(name: string, fallback: boolean): boolean {
  if (typeof document === 'undefined') {
    // Server context (shouldn't normally reach here — use @/flags directly).
    // Fall back to env var so SSR doesn't break.
    return fallback
  }
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  if (!match) return fallback
  return match[1] === '1'
}

const envFocusLinkups = process.env.NEXT_PUBLIC_FEATURE_FOCUS_LINKUPS !== 'false'

export const FEATURES = {
  get FOCUS_LINKUPS(): boolean {
    return readFlagCookie('ff_focus_linkups', envFocusLinkups)
  },
} as const
