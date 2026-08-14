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
// A member's application to become a host: a proposed host name, a pitch, the
// venues they want, and optionally the first rounds they'd run.

/** Bound on rounds proposed in one application — the form is not a bulk importer. */
export const MAX_PROPOSED_EVENTS = 20

/** Bound on brand-new clubs named in one application. */
export const MAX_NEW_VENUES = 10

/** Prefix marking an event's venue as one of this payload's `new_venues`. */
export const NEW_VENUE_REF = 'new:'

/**
 * The venue an application's proposed round sits at: either an existing course id,
 * or `new:<index>` pointing into the same payload's `new_venues`.
 *
 * A club that isn't on LinkUp yet has no course id at the moment the applicant
 * fills the form in — the course is created when the application is submitted, not
 * when they type the name — so rounds at those clubs reference them by position
 * and the server resolves the reference once the courses exist.
 */
export function parseVenueRef(
  value: unknown,
  newVenueCount: number
): { courseId?: string; newVenueIndex?: number; error?: string } {
  if (typeof value !== 'string' || !value.trim()) {
    return { error: 'Choose which venue this round is at' }
  }
  const ref = value.trim()

  if (ref.startsWith(NEW_VENUE_REF)) {
    const index = Number(ref.slice(NEW_VENUE_REF.length))
    if (!Number.isInteger(index) || index < 0 || index >= newVenueCount) {
      return { error: 'A round points at a venue that was not submitted' }
    }
    return { newVenueIndex: index }
  }

  const uuid = validateUUID(ref, 'Venue')
  if (!uuid.valid) return { error: uuid.errors[0] }
  return { courseId: ref }
}

export function validateHostApplicationPayload(body: unknown): ValidationResult {
  if (typeof body !== 'object' || body === null) {
    return { valid: false, errors: ['Invalid request body'] }
  }

  const b = body as Record<string, unknown>
  const errors: string[] = []

  const nameResult = validateString(b.name, 'Host name', { min: 2, max: 120 })
  if (!nameResult.valid) errors.push(...nameResult.errors)

  // The form stopped asking for a description — venues and rounds are what an
  // admin actually reviews. Older clients may still send one, so it is bounded
  // if present but never required.
  if (typeof b.description === 'string' && b.description.trim()) {
    const descResult = validateString(b.description, 'Description', { max: 1000 })
    if (!descResult.valid) errors.push(...descResult.errors)
  }

  // Existing venues the applicant picked, and clubs they named that aren't on
  // LinkUp yet. Either list can be empty, but not both.
  const courseIds = Array.isArray(b.course_ids) ? b.course_ids : []
  const newVenues = Array.isArray(b.new_venues) ? b.new_venues : []

  if (b.course_ids !== undefined && !Array.isArray(b.course_ids)) {
    errors.push('Selected venues must be a list')
  }
  if (b.new_venues !== undefined && !Array.isArray(b.new_venues)) {
    errors.push('New venues must be a list')
  }

  if (courseIds.length === 0 && newVenues.length === 0) {
    errors.push('Choose at least one venue')
  }
  if (courseIds.length > 50) {
    errors.push('Too many venues selected')
  } else if (courseIds.some(id => !validateUUID(id, 'Venue').valid)) {
    errors.push('One of the selected venues is invalid')
  }

  if (newVenues.length > MAX_NEW_VENUES) {
    errors.push(`At most ${MAX_NEW_VENUES} new venues`)
  } else {
    newVenues.forEach((venue, i) => {
      // Same bar as the event form: name and website both. An admin has to find
      // this club and set up a calendar for it, and a name alone can be two
      // different courses in two different states.
      const result = validateProposedClub(venue, { requireWebsite: true })
      if (!result.valid) errors.push(`Venue ${i + 1}: ${result.errors[0]}`)
    })
  }

  // Rounds proposed alongside the application. Optional — an applicant can name
  // their clubs and fill dates in later — but each one has to be a valid event,
  // because approval turns these into real hosted_events.
  if (b.events !== undefined) {
    if (!Array.isArray(b.events)) {
      errors.push('Proposed rounds must be a list')
    } else if (b.events.length > MAX_PROPOSED_EVENTS) {
      errors.push(`At most ${MAX_PROPOSED_EVENTS} proposed rounds`)
    } else {
      b.events.forEach((ev, i) => {
        const round = (ev ?? {}) as Record<string, unknown>

        // The venue is a course id or a new_venues reference, so course_id can't
        // be validated as a plain UUID here.
        const venue = parseVenueRef(round.venue, newVenues.length)
        if (venue.error) {
          errors.push(`Round ${i + 1}: ${venue.error}`)
          return
        }

        // Everything else follows the real event form's rules, so a proposal that
        // validates here can't fail when it's created on approval.
        const result = validateHostedEventPayload(round, { requireCourse: false })
        if (!result.valid) {
          // Number the round so a list of them stays actionable.
          errors.push(`Round ${i + 1}: ${result.errors[0]}`)
        }
      })
    }
  }

  return { valid: errors.length === 0, errors }
}

// ---- Proposed club (a venue not yet on LinkUp) ---------------
// One rule for "the applicant/host is naming a club we don't have yet", shared
// by the host application form, the hosted-event new-club path and
// POST /api/courses/request. These three had drifted apart — the event route
// required a website with no length bound, /api/courses/request treated it as
// optional, and the application form had no website field at all — which meant
// the same club proposed from two places produced two different rows.
//
// `requireWebsite` stays a parameter for /api/courses/request, which has no
// caller in the app today. Both host paths pass it: a club we've never seen has
// to carry enough for an admin to identify and set it up, and chasing a missing
// link by hand was never the good outcome it was assumed to be.
export function validateProposedClub(
  club: unknown,
  options: { requireWebsite?: boolean } = {}
): ValidationResult {
  if (typeof club !== 'object' || club === null) {
    return { valid: false, errors: ['Enter the golf club name'] }
  }

  const c = club as Record<string, unknown>
  const errors: string[] = []
  const { requireWebsite = false } = options

  const nameResult = validateString(c.name, 'Golf club name', { min: 2, max: 120 })
  if (!nameResult.valid) errors.push(...nameResult.errors)

  const rawWebsite = typeof c.website === 'string' ? c.website.trim() : ''
  if (!rawWebsite) {
    if (requireWebsite) errors.push('Enter the club website')
  } else if (!/^https?:\/\/.+/i.test(rawWebsite)) {
    errors.push('Website must be a valid URL (https://…)')
  } else if (rawWebsite.length > 200) {
    errors.push('Website must be 200 characters or less')
  }

  return { valid: errors.length === 0, errors }
}

// ---- Hosted event payload -----------------------------------

/** Bound on dates in one submission — several rounds, not a season's schedule. */
export const MAX_EVENT_DATES = 30

/**
 * The dates a hosted-event payload is asking for, as a list.
 *
 * Accepts `event_dates: string[]` (several events sharing one set of details) or
 * `event_date: string` (the single-date shorthand). Returns null when neither is
 * usable, so callers can tell "no dates given" from "one date given".
 */
export function normaliseEventDates(body: unknown): string[] | null {
  if (typeof body !== 'object' || body === null) return null
  const b = body as Record<string, unknown>

  if (Array.isArray(b.event_dates)) {
    const dates = b.event_dates
      .filter((d): d is string => typeof d === 'string' && d.trim() !== '')
      .map(d => d.trim())
    return dates.length ? dates : null
  }

  if (typeof b.event_date === 'string' && b.event_date.trim()) {
    return [b.event_date.trim()]
  }

  return null
}

// The create/edit form for a hosted event. `partial` (PATCH) only validates the
// fields present. tee_time is optional; total_spots is a small positive int;
// member_guest_rate is a non-negative amount.
export function validateHostedEventPayload(
  body: unknown,
  options: { partial?: boolean; requireCourse?: boolean } = {}
): ValidationResult {
  if (typeof body !== 'object' || body === null) {
    return { valid: false, errors: ['Invalid request body'] }
  }

  const b = body as Record<string, unknown>
  const errors: string[] = []
  const { partial = false, requireCourse = true } = options

  // The "new club" path has no course_id (a pending course is created for it),
  // so callers pass requireCourse: false and validate the club fields instead.
  if (requireCourse && (!partial || 'course_id' in b)) {
    const courseResult = validateUUID(b.course_id, 'Course')
    if (!courseResult.valid) errors.push(...courseResult.errors)
  }

  // One event or several. `event_dates` is the multi-date form — one date per
  // event, sharing everything else on the payload — and `event_date` is the
  // single-date shorthand that predates it. Both go through the same rules so a
  // one-date submission can't behave differently from the first of many.
  if (!partial || 'event_date' in b || 'event_dates' in b) {
    const dates = normaliseEventDates(b)
    if (dates === null || dates.length === 0) {
      errors.push('Choose at least one date')
    } else if (dates.length > MAX_EVENT_DATES) {
      errors.push(`At most ${MAX_EVENT_DATES} dates`)
    } else if (new Set(dates).size !== dates.length) {
      errors.push('Each date can only be entered once')
    } else {
      for (const d of dates) {
        const dateResult = validateDate(d, 'Event date')
        if (!dateResult.valid) {
          errors.push(...dateResult.errors)
          break
        }
      }
    }
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

  // Whether dinner is included — optional boolean.
  if ('dinner' in b && b.dinner !== undefined && typeof b.dinner !== 'boolean') {
    errors.push('Dinner must be true or false')
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
