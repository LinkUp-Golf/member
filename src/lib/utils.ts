// ============================================================
// LinkUp Golf — Utility Functions
// ============================================================

import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, formatDistanceToNow, isToday, isYesterday } from 'date-fns'
import { AVIARA_TIMEZONE } from '@/lib/constants'

// ---- Class name helper --------------------------------------
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ---- Initials from name ------------------------------------
export function getInitials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase()
}

// ---- Date formatting ----------------------------------------

export function bookingToLocalDate(bookingDate: string, teeTime: string): Date {
  const ref = new Date(`${bookingDate}T12:00:00Z`)
  const offsetStr =
    new Intl.DateTimeFormat('en-US', {
      timeZone: AVIARA_TIMEZONE,
      timeZoneName: 'shortOffset',
    })
      .formatToParts(ref)
      .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT-7'
  const m = offsetStr.match(/GMT([+-])(\d+)(?::(\d+))?/)
  const tzOffset = m
    ? `${m[1]}${(m[2] ?? '7').padStart(2, '0')}:${(m[3] ?? '0').padStart(2, '0')}`
    : '-07:00'
  return new Date(`${bookingDate}T${teeTime}${tzOffset}`)
}

export function formatMessageTime(dateString: string): string {
  const date = new Date(dateString)
  if (isToday(date)) return format(date, 'h:mm a')
  if (isYesterday(date)) return 'Yesterday'
  return format(date, 'MMM d')
}

export function formatBookingDate(dateString: string): string {
  return format(new Date(dateString), 'EEEE, MMMM d')
}

export function formatTeeTime(timeString: string): string {
  // timeString is "07:30:00" from PostgreSQL
  const [hours = '0', minutes = '0'] = timeString.split(':')
  const h = parseInt(hours, 10)
  const period = h >= 12 ? 'pm' : 'am'
  const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h
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
