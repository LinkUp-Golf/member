// ============================================================
// LinkUp Golf — Input Validation
// Lightweight validators for all API inputs.
// No external dependency — keeps bundle lean.
// ============================================================

import { isValidTimezone } from '@/lib/timezone'

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

// ---- Email --------------------------------------------------
export function validateEmail(value: unknown): ValidationResult {
  if (typeof value !== 'string' || !value.trim()) {
    return { valid: false, errors: ['Email is required'] }
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(value.trim())) {
    return { valid: false, errors: ['Email address is not valid'] }
  }
  if (value.length > 254) {
    return { valid: false, errors: ['Email address is too long'] }
  }
  return { valid: true, errors: [] }
}

// ---- String field -------------------------------------------
export function validateString(
  value: unknown,
  field: string,
  options: { min?: number; max?: number; required?: boolean } = {}
): ValidationResult {
  const { min = 0, max = 5000, required = true } = options

  if (value === undefined || value === null || value === '') {
    if (required) return { valid: false, errors: [`${field} is required`] }
    return { valid: true, errors: [] }
  }

  if (typeof value !== 'string') {
    return { valid: false, errors: [`${field} must be a string`] }
  }

  if (value.trim().length < min) {
    return { valid: false, errors: [`${field} must be at least ${min} characters`] }
  }

  if (value.trim().length > max) {
    return { valid: false, errors: [`${field} must be at most ${max} characters`] }
  }

  return { valid: true, errors: [] }
}

// ---- Date string --------------------------------------------
export function validateDate(value: unknown, field: string): ValidationResult {
  if (!value) return { valid: false, errors: [`${field} is required`] }
  if (typeof value !== 'string') return { valid: false, errors: [`${field} must be a string`] }

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/
  if (!dateRegex.test(value)) {
    return { valid: false, errors: [`${field} must be in YYYY-MM-DD format`] }
  }

  const date = new Date(value)
  if (isNaN(date.getTime())) {
    return { valid: false, errors: [`${field} is not a valid date`] }
  }

  return { valid: true, errors: [] }
}

// ---- UUID ---------------------------------------------------
export function validateUUID(value: unknown, field: string): ValidationResult {
  if (!value) return { valid: false, errors: [`${field} is required`] }
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (typeof value !== 'string' || !uuidRegex.test(value)) {
    return { valid: false, errors: [`${field} is not a valid ID`] }
  }
  return { valid: true, errors: [] }
}

// ---- Timezone (IANA identifier) ------------------------------
export function validateTimezone(value: unknown, field: string): ValidationResult {
  if (!value) return { valid: false, errors: [`${field} is required`] }
  if (typeof value !== 'string' || !isValidTimezone(value)) {
    return { valid: false, errors: [`${field} is not a valid timezone`] }
  }
  return { valid: true, errors: [] }
}


// ---- Booking payload ----------------------------------------
export function validateBookingPayload(body: unknown): ValidationResult {
  if (typeof body !== 'object' || body === null) {
    return { valid: false, errors: ['Invalid request body'] }
  }

  const b = body as Record<string, unknown>
  const errors: string[] = []

  const dateResult = validateDate(b.date, 'date')
  if (!dateResult.valid) errors.push(...dateResult.errors)

  const teeTimeResult = validateString(b.teeTime, 'teeTime', { min: 5, max: 8 })
  if (!teeTimeResult.valid) errors.push(...teeTimeResult.errors)

  if (b.players !== undefined) {
    const players = Number(b.players)
    if (!Number.isInteger(players) || players < 1 || players > 4) {
      errors.push('Players must be between 1 and 4')
    }
  }

  if (b.guestName !== undefined && b.guestName !== null) {
    const guestResult = validateString(b.guestName, 'guestName', { max: 100 })
    if (!guestResult.valid) errors.push(...guestResult.errors)
  }

  return { valid: errors.length === 0, errors }
}

// ---- Referral payload ---------------------------------------
export function validateReferralPayload(body: unknown): ValidationResult {
  if (typeof body !== 'object' || body === null) {
    return { valid: false, errors: ['Invalid request body'] }
  }

  const b = body as Record<string, unknown>
  const errors: string[] = []

  const emailResult = validateEmail(b.email)
  if (!emailResult.valid) errors.push(...emailResult.errors)

  const nameResult = validateString(b.name, 'name', { min: 2, max: 100 })
  if (!nameResult.valid) errors.push(...nameResult.errors)

  return { valid: errors.length === 0, errors }
}

// ---- Referral partner payload -------------------------------
// Validates the create/edit form for a referral partner. `code` follows the
// same lowercase-hyphen slug shape as course slugs; `percentage` is 0–100.
export function validateReferralPartnerPayload(
  body: unknown,
  options: { partial?: boolean } = {}
): ValidationResult {
  if (typeof body !== 'object' || body === null) {
    return { valid: false, errors: ['Invalid request body'] }
  }

  const b = body as Record<string, unknown>
  const errors: string[] = []
  const { partial = false } = options

  if (!partial || 'name' in b) {
    const nameResult = validateString(b.name, 'Partner name', { min: 2, max: 120 })
    if (!nameResult.valid) errors.push(...nameResult.errors)
  }

  if (!partial || 'code' in b) {
    if (typeof b.code !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(b.code.trim())) {
      errors.push('Code must be lowercase letters, numbers, and hyphens only')
    }
  }

  if (!partial || 'percentage' in b) {
    const pct = Number(b.percentage)
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      errors.push('Percentage must be a number between 0 and 100')
    }
  }

  // Optional in both create and edit — null/'' clears the expiry.
  if ('ends_at' in b && b.ends_at !== null && b.ends_at !== '') {
    const endsResult = validateDate(b.ends_at, 'Rate end date')
    if (!endsResult.valid) errors.push(...endsResult.errors)
  }

  return { valid: errors.length === 0, errors }
}

// ---- Host application payload --------------------------------
// A member's application to become a host: a proposed host name and a pitch.
export function validateHostApplicationPayload(body: unknown): ValidationResult {
  if (typeof body !== 'object' || body === null) {
    return { valid: false, errors: ['Invalid request body'] }
  }

  const b = body as Record<string, unknown>
  const errors: string[] = []

  const nameResult = validateString(b.name, 'Host name', { min: 2, max: 120 })
  if (!nameResult.valid) errors.push(...nameResult.errors)

  const descResult = validateString(b.description, 'Description', { min: 20, max: 1000 })
  if (!descResult.valid) errors.push(...descResult.errors)

  return { valid: errors.length === 0, errors }
}

// ---- Hosted event payload -----------------------------------
// The create/edit form for a hosted event. `partial` (PATCH) only validates the
// fields present. tee_time is optional; total_spots is a small positive int;
// member_guest_rate is a non-negative amount.
export function validateHostedEventPayload(
  body: unknown,
  options: { partial?: boolean } = {}
): ValidationResult {
  if (typeof body !== 'object' || body === null) {
    return { valid: false, errors: ['Invalid request body'] }
  }

  const b = body as Record<string, unknown>
  const errors: string[] = []
  const { partial = false } = options

  if (!partial || 'course_id' in b) {
    const courseResult = validateUUID(b.course_id, 'Course')
    if (!courseResult.valid) errors.push(...courseResult.errors)
  }

  if (!partial || 'event_date' in b) {
    const dateResult = validateDate(b.event_date, 'Event date')
    if (!dateResult.valid) errors.push(...dateResult.errors)
  }

  // Optional free text in both create and edit — null/'' means no fixed tee
  // time. A host types whatever suits ("8:30 AM", "Shotgun 9am"); we only bound
  // the length.
  if ('tee_time' in b && b.tee_time !== null && b.tee_time !== '') {
    const teeResult = validateString(b.tee_time, 'Tee time', { max: 50, required: false })
    if (!teeResult.valid) errors.push(...teeResult.errors)
  }

  if (!partial || 'total_spots' in b) {
    const spots = Number(b.total_spots)
    if (!Number.isInteger(spots) || spots < 1 || spots > 200) {
      errors.push('Available spots must be a whole number between 1 and 200')
    }
  }

  if (!partial || 'member_guest_rate' in b) {
    const rate = Number(b.member_guest_rate)
    if (!Number.isFinite(rate) || rate < 0 || rate > 100000) {
      errors.push('Member guest rate must be a positive amount')
    }
  }

  if ('description' in b && b.description !== null && b.description !== '') {
    const descResult = validateString(b.description, 'Description', { max: 2000, required: false })
    if (!descResult.valid) errors.push(...descResult.errors)
  }

  return { valid: errors.length === 0, errors }
}

// ---- Message payload ----------------------------------------
export function validateMessagePayload(body: unknown): ValidationResult {
  if (typeof body !== 'object' || body === null) {
    return { valid: false, errors: ['Invalid request body'] }
  }

  const b = body as Record<string, unknown>
  const errors: string[] = []

  const bodyResult = validateString(b.body, 'message', { min: 1, max: 4000 })
  if (!bodyResult.valid) errors.push(...bodyResult.errors)

  const convResult = validateUUID(b.conversationId, 'conversationId')
  if (!convResult.valid) errors.push(...convResult.errors)

  return { valid: errors.length === 0, errors }
}

// ---- Sanitise text (strip HTML tags) ------------------------
export function sanitiseText(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .trim()
}

// ---- Combine multiple results -------------------------------
export function combineResults(...results: ValidationResult[]): ValidationResult {
  const errors = results.flatMap(r => r.errors)
  return { valid: errors.length === 0, errors }
}
