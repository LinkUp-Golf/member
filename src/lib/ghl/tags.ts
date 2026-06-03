// ============================================================
// GHL Tag constants — single source of truth.
// Every tag reference across the codebase imports from here.
// Adding a new course/location only requires adding a row here.
// ============================================================

// ---- Active member tags per course --------------------------
// Keys are GHL contact tags; values are Supabase course slugs.
export const COURSE_TAG_MAP = {
  'avi member':          'aviara',
  'avi member - active': 'aviara',
} as const satisfies Record<string, string>

export type CourseTag = keyof typeof COURSE_TAG_MAP
export type CourseSlug = (typeof COURSE_TAG_MAP)[CourseTag]

// ---- Derived helpers ----------------------------------------

/** All tags that grant any course access */
export const ALL_ACCESS_TAGS = Object.keys(COURSE_TAG_MAP) as CourseTag[]

/** Unique course slugs across all access tags — use this instead of hardcoding a slug. */
export const COURSE_SLUGS = [...new Set(Object.values(COURSE_TAG_MAP))] as CourseSlug[]

/** Returns true if a tag grants access to any course */
export function isAccessTag(tag: string): tag is CourseTag {
  return tag in COURSE_TAG_MAP
}

/** Returns the course slug for a given access tag, or null */
export function courseSlugForTag(tag: string): CourseSlug | null {
  return (COURSE_TAG_MAP as Record<string, string>)[tag] as CourseSlug ?? null
}

/** Returns true if a tag array contains at least one access tag */
export function hasAnyAccessTag(tags: string[]): boolean {
  return ALL_ACCESS_TAGS.some(tag => tags.includes(tag))
}
