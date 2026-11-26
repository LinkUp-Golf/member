// ============================================================
// Two-way profile sync with GoHighLevel — the pure rules.
// Pure, so every rule is tested (src/__tests__/ghl-profile-fields.test.ts);
// the I/O is in src/lib/sync/profile.push.ts (app → GHL) and
// src/lib/sync/profile.sync.ts (GHL → app).
//
// What travels both ways (decided 2026-11-26, docs/proposals/ghl-profile-sync.html):
//   Organization  ⇄  GHL's built-in Business Name (companyName; GHL shows its
//                    merge key as contact.company_name, but it is NOT a custom
//                    field). The duplicates — "Business Name"
//                    (contact.contacttitle_ld2_copy) and "Company"
//                    (contact.company) — were cleaned up on 2026-11-26 and are
//                    neither read nor written.
//   Title         ⇄  custom field contact.title
//   LinkedIn URL  ⇄  custom field contact.linkedin
//   Non-profits   ⇄  custom field contact.nonprofits, one per line
//   Date of birth ⇄  standard field dateOfBirth (private; matching only)
//   Gender        ⇄  tags gender-male / gender-female / gender-pns (private)
// Community comes from the membership tag (GHL → app only).
// Name, email and phone stay GHL-only: members can't edit them in the app.
// ============================================================

import { MAX_NONPROFITS, parseNonprofits } from '@/lib/profile/nonprofits'

// ---- Gender -------------------------------------------------

export const GENDER_TAGS = {
  male: 'gender-male',
  female: 'gender-female',
  prefer_not: 'gender-pns',
} as const

export type StoredGender = keyof typeof GENDER_TAGS

const norm = (tag: string) => tag.trim().toLowerCase()
const GENDER_BY_TAG = new Map<string, StoredGender>(
  Object.entries(GENDER_TAGS).map(([g, t]) => [t, g as StoredGender]),
)

export function isGenderTag(tag: string): boolean {
  return GENDER_BY_TAG.has(norm(tag))
}

/**
 * The gender a contact's tags say. More than one gender tag is a mistake made
 * in GHL: it reads as unanswered, and `conflict` says so, so the sync can tell
 * an admin rather than guess.
 */
export function genderFromTags(tags: readonly string[]): { gender: StoredGender | null; conflict: boolean } {
  const found = [...new Set(tags.map(norm).filter(t => GENDER_BY_TAG.has(t)))]
  if (found.length === 1) return { gender: GENDER_BY_TAG.get(found[0] ?? '') ?? null, conflict: false }
  return { gender: null, conflict: found.length > 1 }
}

/**
 * The tags the app keeps a copy of on `members.ghl_tags`, minus gender. That
 * copy reaches other members' devices in places, and gender is private — it's
 * held only in member_match_profiles.
 */
export function withoutGenderTags(tags: readonly string[]): string[] {
  return tags.filter(t => !isGenderTag(t))
}

/** The one tag to add and the others to remove so GHL says exactly `gender`. */
export function genderTagChanges(gender: StoredGender | null): { add: string[]; remove: string[] } {
  const all = Object.values(GENDER_TAGS) as string[]
  if (!gender) return { add: [], remove: all }
  const keep = GENDER_TAGS[gender]
  return { add: [keep], remove: all.filter(t => t !== keep) }
}

export function isStoredGender(v: unknown): v is StoredGender {
  return typeof v === 'string' && v in GENDER_TAGS
}

// ---- Community ----------------------------------------------

/**
 * Membership tag → community. One tag decides both whether someone is a
 * member and which community they're in, so the two can't disagree. A new
 * community is a new row here (and in COURSE_TAG_MAP for access).
 */
export const COMMUNITY_BY_TAG: Record<string, string> = {
  'member-active-sd': 'San Diego',
}

export function communityFromTags(tags: readonly string[]): string | null {
  for (const t of tags) {
    const c = COMMUNITY_BY_TAG[norm(t)]
    if (c) return c
  }
  return null
}

// ---- Date of birth ------------------------------------------

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * A date of birth as YYYY-MM-DD, or null when it isn't a real date of someone
 * between 18 and 110 on `today`. Membership is adults-only, so anything else is
 * a typo, and a typo here would quietly break age preferences.
 */
export function parseDateOfBirth(value: unknown, today: Date): string | null {
  if (typeof value !== 'string') return null
  const m = ISO_DATE.exec(value.trim())
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(y, mo - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null
  const age = ageOn(`${m[1]}-${m[2]}-${m[3]}`, today)
  return age >= 18 && age <= 110 ? `${m[1]}-${m[2]}-${m[3]}` : null
}

/** Whole years old on `today` (UTC calendar). */
export function ageOn(dob: string, today: Date): number {
  const [y = 0, m = 0, d = 0] = dob.split('-').map(Number)
  let age = today.getUTCFullYear() - y
  const before = today.getUTCMonth() + 1 < m || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d)
  if (before) age--
  return age
}

/**
 * GHL's dateOfBirth as YYYY-MM-DD. It arrives as a date, a full timestamp, or
 * epoch milliseconds depending on the endpoint; anything else reads as blank.
 */
export function dobFromGhl(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString().slice(0, 10)
  if (typeof value !== 'string' || !value.trim()) return null
  const head = value.trim().slice(0, 10)
  return ISO_DATE.test(head) ? head : null
}

// ---- The GHL contact update ---------------------------------

/**
 * Custom-field object keys, as GHL names them. Title is the single-line
 * contact.title — not the multi-line "Title" duplicate
 * (contact.contactcompany_qy9_copy). Organization isn't here: it's a built-in
 * field (companyName), written directly.
 */
export const PROFILE_CUSTOM_FIELD_KEYS = {
  role_title: 'contact.title',
  linkedin_url: 'contact.linkedin',
  nonprofits: 'contact.nonprofits',
} as const

export type SyncedProfileField = 'business_name' | keyof typeof PROFILE_CUSTOM_FIELD_KEYS

export interface ProfileChanges {
  business_name?: string | null
  role_title?: string | null
  linkedin_url?: string | null
  nonprofits?: string[] | null
  /** YYYY-MM-DD, or null to clear (including "Prefer not to say"). */
  date_of_birth?: string | null
}

export interface GhlContactUpdate {
  companyName?: string
  dateOfBirth?: string | null
  customFields?: Array<{ id: string; field_value: string }>
}

/**
 * The body of PUT /contacts/:id for these changes. A field whose custom-field
 * id GHL doesn't know is reported in `missing` rather than skipped silently:
 * the caller fails the save, because a profile edit that never reaches GHL is
 * undone by the next sync.
 */
export function contactUpdateBody(
  changes: ProfileChanges,
  idByKey: ReadonlyMap<string, string>,
): { body: GhlContactUpdate; missing: string[] } {
  const body: GhlContactUpdate = {}
  const customFields: Array<{ id: string; field_value: string }> = []
  const missing: string[] = []

  const custom = (field: keyof typeof PROFILE_CUSTOM_FIELD_KEYS, value: string) => {
    const key = PROFILE_CUSTOM_FIELD_KEYS[field]
    const id = idByKey.get(key)
    if (id) customFields.push({ id, field_value: value })
    else missing.push(key)
  }

  if ('business_name' in changes) body.companyName = (changes.business_name ?? '').trim()
  if ('role_title' in changes) custom('role_title', (changes.role_title ?? '').trim())
  if ('linkedin_url' in changes) custom('linkedin_url', (changes.linkedin_url ?? '').trim())
  if ('nonprofits' in changes) {
    const list = parseNonprofits(changes.nonprofits ?? []).slice(0, MAX_NONPROFITS)
    custom('nonprofits', list.join('\n'))
  }
  if ('date_of_birth' in changes) body.dateOfBirth = changes.date_of_birth ?? null

  if (customFields.length) body.customFields = customFields
  return { body, missing }
}

/**
 * Of the fields a profile save touches, the ones GHL holds, and only where the
 * value actually changes — so an unrelated save (text size, say) never calls
 * GHL, and a GHL outage never blocks it.
 */
export function syncedChanges(
  before: Partial<Record<SyncedProfileField, unknown>>,
  after: Partial<Record<SyncedProfileField, unknown>>,
): ProfileChanges {
  const out: ProfileChanges = {}
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  for (const field of ['business_name', 'role_title', 'linkedin_url'] as const) {
    if (!(field in after)) continue
    if (text(after[field]) !== text(before[field])) out[field] = text(after[field]) || null
  }
  if ('nonprofits' in after) {
    const a = parseNonprofits((after.nonprofits ?? []) as string[])
    const b = parseNonprofits((before.nonprofits ?? []) as string[])
    if (a.join('\n') !== b.join('\n')) out.nonprofits = a
  }
  return out
}
