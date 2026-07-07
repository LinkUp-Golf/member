// ============================================================
// Timezone helpers — browser Intl detection (chat/notification
// timestamp fallback) and IANA validity checks (course timezone form).
// ============================================================

export function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return 'UTC'
  }
}

export function isValidTimezone(value: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value })
    return true
  } catch {
    return false
  }
}
