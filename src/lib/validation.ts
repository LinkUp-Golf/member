// ============================================================
// LinkUp Golf — Input Validation
// Lightweight validators for all API inputs.
// No external dependency — keeps bundle lean.
// ============================================================

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
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .trim()
}

// ---- Combine multiple results -------------------------------
export function combineResults(...results: ValidationResult[]): ValidationResult {
  const errors = results.flatMap(r => r.errors)
  return { valid: errors.length === 0, errors }
}
