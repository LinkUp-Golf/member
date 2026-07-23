// ============================================================
// GHL Tag constants — single source of truth.
// Every tag reference across the codebase imports from here.
// Adding a new course/location only requires adding a row here.
// ============================================================

// ---- Active member tags per course --------------------------
// Keys are GHL contact tags; values are Supabase course slugs.
export const COURSE_TAG_MAP = {
  'avi member':          'aviara',
  'avi member - active': 'aviara', // id to trigger ghl workflow
  'nbd client':          'aviara',
} as const satisfies Record<string, string>

export type CourseTag = keyof typeof COURSE_TAG_MAP
export type CourseSlug = (typeof COURSE_TAG_MAP)[CourseTag]

// ---- Derived helpers ----------------------------------------

/** All tags that grant any course access */
export const ALL_ACCESS_TAGS = Object.keys(COURSE_TAG_MAP) as CourseTag[]

/** Unique course slugs across all access tags — use this instead of hardcoding a slug. */
export const COURSE_SLUGS = [...new Set(Object.values(COURSE_TAG_MAP))] as CourseSlug[]

// ---- Role tags ----------------------------------------------
// GHL tags that make someone a referral partner / host. These grant app access
// on their own — a person carrying one can log in and use their workspace even
// without a golf membership (they become a 'non_member' member row with no home
// course). Someone can hold both a membership tag and a role tag.
export const PARTNER_ROLE_TAG = 'referral-partner'
export const HOST_ROLE_TAG = 'host'
export const ROLE_ACCESS_TAGS = [PARTNER_ROLE_TAG, HOST_ROLE_TAG] as const

/** Every tag that lets someone into the app — course/membership tags plus roles. */
export const ALL_LOGIN_TAGS = [...ALL_ACCESS_TAGS, ...ROLE_ACCESS_TAGS] as string[]

/** Returns true if a tag grants access to any course */
export function isAccessTag(tag: string): tag is CourseTag {
  return tag in COURSE_TAG_MAP
}

/** Returns the course slug for a given access tag, or null */
export function courseSlugForTag(tag: string): CourseSlug | null {
  return (COURSE_TAG_MAP as Record<string, string>)[tag] as CourseSlug ?? null
}

/** Whether the person carries the referral-partner role tag. */
export function hasPartnerTag(tags: string[]): boolean {
  return tags.includes(PARTNER_ROLE_TAG)
}

/** Whether the person carries the host role tag. */
export function hasHostTag(tags: string[]): boolean {
  return tags.includes(HOST_ROLE_TAG)
}

/**
 * Returns true if a tag array lets the person into the app at all — a course
 * access tag OR a role tag (referral partner / host). This is the login gate
 * used at magic-link request, callback, and the per-request revalidator.
 */
export function hasAnyAccessTag(tags: string[]): boolean {
  return ALL_ACCESS_TAGS.some(tag => tags.includes(tag)) || ROLE_ACCESS_TAGS.some(tag => tags.includes(tag))
}

/** Whether the person holds a course access tag (i.e. is a golf member, not a role-only user). */
export function hasCourseAccessTag(tags: string[]): boolean {
  return ALL_ACCESS_TAGS.some(tag => tags.includes(tag))
}

// ---- Membership tags ----------------------------------------
// The tags that mean "this person holds a membership" — the signal referral
// commission is paid on. Narrower than ALL_ACCESS_TAGS on purpose: an access
// tag like 'nbd client' grants course access without being a membership.
export const MEMBERSHIP_TAGS = ['avi member', 'avi member - active'] as const

/** Returns true if a tag array marks the person as a member. */
export function hasMembershipTag(tags: string[]): boolean {
  return MEMBERSHIP_TAGS.some(tag => tags.includes(tag))
}
