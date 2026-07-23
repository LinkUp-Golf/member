// ============================================================
// LinkUp Golf — Utility Functions
// ============================================================

import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { formatDistanceToNow } from 'date-fns'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { AVIARA_TIMEZONE } from '@/lib/constants'
import { getBrowserTimezone } from '@/lib/timezone'

// ---- Class name helper --------------------------------------
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ---- Initials from name ------------------------------------
export function getInitials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase()
}

// ---- Safe internal redirect target --------------------------
// Guards post-login redirects (`next`/`redirectTo`) against open-redirect:
// only a same-origin absolute path (single leading slash) is allowed.
// Rejects absolute URLs ("https://evil.com") and protocol-relative
// ("//evil.com"), both of which escape the origin via `new URL(next, base)`.
export function safeRedirectPath(
  next: string | null | undefined,
  fallback = '/home'
): string {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//')) {
    return fallback
  }
  return next
}

// ---- Date formatting ----------------------------------------

// Returns a JS Date (UTC) for past/future comparisons and hour-difference logic.
// DO NOT use this for display — the result renders in the browser's local timezone,
// which will shift the date/time. For display, use booking_date + formatTeeTime(tee_time)
// directly, since they are already stored in the course's local timezone.
//
// `timezone` should be the booking's own course.timezone — it defaults to
// AVIARA_TIMEZONE only for call sites that don't have course data on hand
// (or pre-multi-course data). Passing the wrong timezone shifts cancellation-
// policy eligibility and upcoming/past bucketing for any course outside
// Pacific time.
export function bookingToLocalDate(bookingDate: string, teeTime: string, timezone: string = AVIARA_TIMEZONE): Date {
  return fromZonedTime(`${bookingDate}T${teeTime}`, timezone)
}

// Calendar-day key ("2026-01-15") for a Date in a given IANA timezone —
// used to compare "is this the same day" without the runtime's own local
// zone leaking in.
function dayKey(date: Date, timezone: string): string {
  return formatInTimeZone(date, timezone, 'yyyy-MM-dd')
}

// Personal/viewer-perspective timestamp (messages, notifications, admin
// views) — always uses the viewer's own browser-detected timezone, since
// there's no per-member timezone preference to defer to.
// Do NOT use this for booking tee times — those are anchored to the course's
// own timezone regardless of viewer (see formatTeeTime / bookingToLocalDate).
export function formatMessageTime(dateString: string): string {
  const tz = getBrowserTimezone()
  const date = new Date(dateString)
  const now = new Date()
  if (dayKey(date, tz) === dayKey(now, tz)) {
    return formatInTimeZone(date, tz, 'h:mm a')
  }
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  if (dayKey(date, tz) === dayKey(yesterday, tz)) return 'Yesterday'
  return formatInTimeZone(date, tz, 'MMM d')
}

// dateString here is always a plain "YYYY-MM-DD" calendar date (booking_date,
// visit_from/until, event_date, promo expires_at) — not a specific instant.
// Format it as UTC so it renders as the literal calendar date everywhere,
// instead of `new Date('2026-01-15')` (parsed as UTC midnight) shifting to
// the previous day once rendered in any timezone behind UTC.
export function formatBookingDate(dateString: string): string {
  return formatInTimeZone(new Date(dateString), 'UTC', 'EEEE, MMMM d')
}

export function formatTeeTime(timeString: string): string {
  // timeString is "07:30:00" from PostgreSQL
  const [hours = '0', minutes = '0'] = timeString.split(':')
  const h = parseInt(hours, 10)
  const period = h >= 12 ? 'pm' : 'am'
  const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h
  return `${h12}:${minutes} ${period}`
}

// A hosted event's tee time is free text — a host can type "8:30 AM", "Shotgun
// 9am", or leave it blank — but events listed from a real booking (and legacy
// rows) still store a "HH:MM[:SS]" clock value. Format the clock case to a 12h
// label; show anything else exactly as the host wrote it.
const CLOCK_RE = /^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/
export function formatEventTeeTime(value: string | null | undefined): string | null {
  const t = value?.trim()
  if (!t) return null
  if (!CLOCK_RE.test(t)) return t
  const [hours = '0', minutes = '00'] = t.split(':')
  const h = parseInt(hours, 10)
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${h12}:${minutes} ${period}`
}

export function formatRelativeTime(dateString: string): string {
  return formatDistanceToNow(new Date(dateString), { addSuffix: true })
}

// ---- Currency -----------------------------------------------
export function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100)
}

// ---- Avatar colour from initials ---------------------------
// Returns a deterministic Tailwind background class
const AVATAR_COLOURS = [
  'bg-green-800',
  'bg-green-700',
  'bg-green-600',
  'bg-green-900',
]

export function getAvatarColour(id: string): string {
  const index = id.charCodeAt(0) % AVATAR_COLOURS.length
  return AVATAR_COLOURS[index] ?? 'bg-green-800'
}

// ---- Truncate text -----------------------------------------
export function truncate(text: string, maxLength: number): string {
  const chars = [...text]
  if (chars.length <= maxLength) return text
  return chars.slice(0, maxLength).join('').trimEnd() + '…'
}

// Title-cases a person's name for display in copy where CSS `capitalize`
// isn't available (server-built messages, notifications). Names are often
// stored lower-case, so "mary jane o'neil" -> "Mary Jane O'neil".
export function titleCaseName(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

// ---- Industry category short label -------------------------
export function shortCategory(category: string): string {
  const map: Record<string, string> = {
    'Business Owner / Founder': 'Founder',
    'Professional Services (Legal)': 'Legal',
    'Professional Services (Accounting)': 'Accounting',
    'Professional Services (Consulting)': 'Consulting',
    'Capital Provider': 'Capital',
    'Insurance': 'Insurance',
    'Business Software': 'Software',
    'Business Services': 'Biz Services',
    'HR & Recruitment': 'HR',
    'Real Estate': 'Real Estate',
    'Healthcare / Life Sciences': 'Life Sciences',
    'Financial Services': 'Finance',
    'Technology': 'Technology',
    'Other': 'Other',
  }
  return map[category] ?? category
}

// ---- Date array for booking picker -------------------------
export function getBookingDates(windowDays = 60, minDaysOut = 3): Date[] {
  const dates: Date[] = []
  const today = new Date()
  for (let i = minDaysOut; i <= windowDays; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    dates.push(d)
  }
  return dates
}
