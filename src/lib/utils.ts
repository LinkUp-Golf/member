// ============================================================
// LinkUp Golf — Utility Functions
// ============================================================

import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { formatDistanceToNow } from 'date-fns'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { AVIARA_TIMEZONE, DEFAULT_LANDING_PATH } from '@/lib/constants'
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
  fallback = DEFAULT_LANDING_PATH
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

// Ordering key for the same free-text tee time: minutes since midnight, or
// MAX_SAFE_INTEGER when no time can be read so blank/vague times sort last.
// Comparing the raw strings puts "10:00 AM" before "8:30 AM".
export function eventTeeTimeSortKey(value: string | null | undefined): number {
  const LAST = Number.MAX_SAFE_INTEGER
  const t = value?.trim()
  if (!t) return LAST

  // Prefer an "H:MM" clock; only fall back to a bare hour when it carries
  // am/pm, so a stray number ("2 groups, tee off soon") isn't read as a time.
  const hhmm = /(\d{1,2}):([0-5]\d)(?::[0-5]\d)?\s*(am|pm)?/i.exec(t)
  const hour = hhmm ? null : /(\d{1,2})\s*(am|pm)/i.exec(t)
  const m = hhmm ?? hour
  if (!m) return LAST

  let h = parseInt(m[1] ?? '', 10)
  if (Number.isNaN(h)) return LAST
  const minutes = hhmm?.[2] ? parseInt(hhmm[2], 10) : 0
  const period = (hhmm?.[3] ?? hour?.[2])?.toLowerCase()
  if (h > 23 || (period && h > 12)) return LAST
  if (period === 'pm' && h < 12) h += 12
  if (period === 'am' && h === 12) h = 0
  return h * 60 + minutes
}

/**
 * A run of dates, written the way a person would say it.
 *
 * A list of thirty "Sat, Oct 4 · Sun, Oct 5 · Mon, Oct 6" reads as noise, and
 * the thing it's hiding — that those are three days in a row — is exactly what
 * the reader is trying to work out. So consecutive days collapse into a range
 * and the month is named once:
 *
 *   ['2026-08-04']                          → 'Sat, Aug 4'
 *   ['2026-08-04','2026-08-05']             → 'Aug 4–5'
 *   ['2026-08-04','2026-08-18']             → 'Aug 4, 18'
 *   ['2026-08-04','2026-08-05','2026-09-01']→ 'Aug 4–5 · Sep 1'
 *   ['2026-12-30','2027-01-02']             → 'Dec 30 · Jan 2 2027'
 *
 * A single date keeps its weekday: one date is short enough to carry it, and
 * which day of the week it falls on is usually the question. Past that, the
 * weekdays are what makes the list unreadable.
 *
 * Years appear only when they aren't the current one. Input may be in any order
 * and may repeat; the output is sorted and deduplicated.
 *
 * Takes and returns nothing but 'YYYY-MM-DD' strings — no timezone is involved,
 * because a chosen date isn't a moment.
 */
export function summariseDates(dates: string[]): string {
  // Shape-checked rather than just non-empty: anything else reaching the date
  // maths comes back out as "Invalid Date", which is worse than being dropped.
  const sorted = Array.from(
    new Set(dates.map(d => (d ?? '').trim()).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))),
  ).sort()
  if (sorted.length === 0) return ''

  const thisYear = new Date().getFullYear()
  const parse = (d: string) => {
    const [y, m, day] = d.split('-').map(Number)
    return { y: y ?? 0, m: m ?? 1, day: day ?? 1 }
  }
  const monthName = (m: number) =>
    ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1] ?? ''

  if (sorted.length === 1) {
    const only = sorted[0] as string
    const { y } = parse(only)
    // Midday so the string can't be pushed onto the neighbouring day.
    const weekday = new Date(`${only}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' })
    const { m, day } = parse(only)
    return `${weekday}, ${monthName(m)} ${day}${y === thisYear ? '' : ` ${y}`}`
  }

  // Consecutive days become one run. Comparing the day-count between two dates
  // rather than day+1 keeps month and year ends honest (31 Aug → 1 Sep is a run).
  const dayNumber = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86400000)
  const runs: string[][] = []
  for (const date of sorted) {
    const current = runs[runs.length - 1]
    const previous = current?.[current.length - 1]
    if (current && previous && dayNumber(date) - dayNumber(previous) === 1) current.push(date)
    else runs.push([date])
  }

  // Then grouped by the month they start in, so a month is named once even when
  // it holds several runs. A run spanning a month boundary belongs to its start.
  const groups: { y: number; m: number; parts: string[] }[] = []
  for (const run of runs) {
    const first = run[0] as string
    const last = run[run.length - 1] as string
    const { y, m, day } = parse(first)
    const end = parse(last)

    const group = groups[groups.length - 1]
    const target =
      group && group.y === y && group.m === m
        ? group
        : (groups.push({ y, m, parts: [] }), groups[groups.length - 1] as { y: number; m: number; parts: string[] })

    if (run.length === 1) target.parts.push(String(day))
    else if (end.m === m) target.parts.push(`${day}–${end.day}`)
    // A run that crosses into the next month has to name it, or "30–2" reads as
    // a typo.
    else target.parts.push(`${day} – ${monthName(end.m)} ${end.day}`)
  }

  return groups
    .map(g => `${monthName(g.m)} ${g.parts.join(', ')}${g.y === thisYear ? '' : ` ${g.y}`}`)
    .join(' · ')
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
