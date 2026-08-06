// ============================================================
// GHL Tag constants — single source of truth.
// Every tag reference across the codebase imports from here.
// Adding a new course/location only requires adding a row here.
// ============================================================

// ---- Active member tags per course --------------------------
// Keys are GHL contact tags; values are Supabase course slugs.
//
// 'member-active-SD' follows the community-scoped scheme we're moving to:
// <what>-<state>-<COMMUNITY>, where SD is San Diego. A second community lands
// as 'member-active-LA' pointing at its own slug, instead of needing another
// course-specific prefix like 'avi'. The 'avi …' spellings predate the scheme
// and stay live — this is purely additive, so nobody loses access.
export const COURSE_TAG_MAP = {
  'avi member':          'aviara',
  'avi member - active': 'aviara', // id to trigger ghl workflow
  'member-active-SD':    'aviara',
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

// ---- Case-insensitive matching ------------------------------
// Tag checks compare normalised forms, never raw strings. GHL applies its own
// case rules to a tag name, an admin can retype one by hand when granting
// access, and 'member-active-SD' is the first tag we carry that isn't already
// lowercase — so an exact match would leave course access, and the login gate
// behind it, depending on capitalisation nobody controls.
//
// Only the comparison is normalised. The map keys keep GHL's own spelling
// because that's what gets written back onto a contact.

const norm = (tag: string) => tag.trim().toLowerCase()

const COURSE_SLUG_BY_NORM: ReadonlyMap<string, CourseSlug> = new Map(
  Object.entries(COURSE_TAG_MAP).map(([tag, slug]) => [norm(tag), slug])
)

/** Case-insensitive "is `tag` in this list". */
function holds(tags: string[], tag: string): boolean {
  const target = norm(tag)
  return tags.some(t => norm(t) === target)
}

/** Case-insensitive "do these two tag lists share anything". */
export function tagsOverlap(a: string[], b: string[]): boolean {
  const first = new Set(a.map(norm))
  return b.some(tag => first.has(norm(tag)))
}

/**
 * Returns true if a tag grants access to any course.
 *
 * Not a `tag is CourseTag` guard any more: 'AVI MEMBER' passes this check but
 * isn't literally one of the map's keys, so narrowing to CourseTag would be a
 * lie the compiler believes.
 */
export function isAccessTag(tag: string): boolean {
  return COURSE_SLUG_BY_NORM.has(norm(tag))
}

/** Returns the course slug for a given access tag, or null */
export function courseSlugForTag(tag: string): CourseSlug | null {
  return COURSE_SLUG_BY_NORM.get(norm(tag)) ?? null
}

/**
 * The course access tags this list holds, in COURSE_TAG_MAP order, spelled the
 * canonical way regardless of how they arrived. The first entry is the one the
 * sync treats as the member's home course.
 */
export function courseTagsHeld(tags: string[]): CourseTag[] {
  return ALL_ACCESS_TAGS.filter(tag => holds(tags, tag))
}

/** Whether the person carries the referral-partner role tag. */
export function hasPartnerTag(tags: string[]): boolean {
  return holds(tags, PARTNER_ROLE_TAG)
}

/** Whether the person carries the host role tag. */
export function hasHostTag(tags: string[]): boolean {
  return holds(tags, HOST_ROLE_TAG)
}

/**
 * Returns true if a tag array lets the person into the app at all — a course
 * access tag OR a role tag (referral partner / host). This is the login gate
 * used at magic-link request, callback, and the per-request revalidator.
 */
export function hasAnyAccessTag(tags: string[]): boolean {
  return ALL_ACCESS_TAGS.some(tag => holds(tags, tag)) || ROLE_ACCESS_TAGS.some(tag => holds(tags, tag))
}

/** Whether the person holds a course access tag (i.e. is a golf member, not a role-only user). */
export function hasCourseAccessTag(tags: string[]): boolean {
  return ALL_ACCESS_TAGS.some(tag => holds(tags, tag))
}

// ---- Membership tags ----------------------------------------
// The tags that mean "this person holds a membership" — the signal referral
// commission is paid on. Narrower than ALL_ACCESS_TAGS on purpose: an access
// tag like 'nbd client' grants course access without being a membership.
// 'member-active-SD' belongs here, not just in COURSE_TAG_MAP: it means an
// active member, so a referral that converts into one has to earn commission
// the same as 'avi member - active' does. `satisfies` keeps this list honest —
// a tag named here that isn't a real course tag won't compile.
export const MEMBERSHIP_TAGS = [
  'avi member',
  'avi member - active',
  'member-active-SD',
] as const satisfies readonly CourseTag[]

/** Returns true if a tag array marks the person as a member. */
export function hasMembershipTag(tags: string[]): boolean {
  return MEMBERSHIP_TAGS.some(tag => holds(tags, tag))
}
