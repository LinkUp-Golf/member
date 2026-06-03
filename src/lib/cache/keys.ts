// ============================================================
// Cache key builders and TTL constants.
//
// Naming scheme:
//   {scope}:{namespace}:{identifier}:{variant}
//
// Rules:
//   - Public/shared keys are scoped by course (not user).
//   - User-specific keys are always scoped by userId.
//   - Never share a user-scoped key across users.
// ============================================================

// ---- Namespaces --------------------------------------------

export const MEMBER_ROW_NS      = 'member:row'
export const MEMBER_DETAIL_NS   = 'member:detail'
export const COURSE_ANN_NS      = 'course:ann'
export const COURSE_PROMO_NS    = 'course:promo'
export const COURSE_LINKUPS_NS  = 'course:linkups'
export const COURSE_MEMBERS_NS  = 'course:members'
export const GHL_SLOTS_NS       = 'ghl:slots'

// ---- TTLs --------------------------------------------------

export const MEMBER_ROW_TTL_MS     = 5  * 60_000   // 5 min  — auth-adjacent, keep short
export const MEMBER_DETAIL_TTL_MS  = 30 * 60_000   // 30 min — public-ish profile data
export const COURSE_ANN_TTL_MS     = 5  * 60_000   // 5 min  — new bookings auto-post here
export const COURSE_PROMO_TTL_MS   = 30 * 60_000   // 30 min — admin-managed, infrequent
export const COURSE_LINKUPS_TTL_MS = 60 * 60_000   // 1 hour — changes once per day at most
export const COURSE_MEMBERS_TTL_MS = 15 * 60_000   // 15 min — status changes are admin-driven
export const GHL_SLOTS_TTL_MS      = 30 * 60_000   // 30 min — availability shifts slowly

// ---- Key builders ------------------------------------------

// Cached member row (ghl_contact_id, is_admin, home_course_id).
// User-scoped — never share across users.
export const memberRowKey = (userId: string) =>
  `${MEMBER_ROW_NS}:${userId}`

// Public member profile (members + member_profiles + courses join).
// Safe to share across callers since it is the same for everyone viewing
// the same member. Invalidated when the member updates their profile.
export const memberDetailKey = (memberId: string) =>
  `${MEMBER_DETAIL_NS}:${memberId}`

// Published announcements for a course.
// Course-scoped, not user-scoped — same content for all course members.
// Variant key includes limit so different page sizes don't collide.
export const courseAnnKey    = (courseId: string, limit: number) =>
  `${COURSE_ANN_NS}:${courseId}:${limit}`
export const courseAnnPrefix = (courseId: string) =>
  `${COURSE_ANN_NS}:${courseId}:`

// Active promotions for a course.
export const coursePromoKey    = (courseId: string, limit: number) =>
  `${COURSE_PROMO_NS}:${courseId}:${limit}`
export const coursePromoPrefix = (courseId: string) =>
  `${COURSE_PROMO_NS}:${courseId}:`

// Upcoming focus linkups for a course.
// No limit variant — we always fetch all upcoming, capped at 10 in the query.
export const courseLinkupsKey = (courseId: string) =>
  `${COURSE_LINKUPS_NS}:${courseId}`

// Active members list for a course.
export const courseMembersKey    = (courseId: string, orderBy: string, limit: number) =>
  `${COURSE_MEMBERS_NS}:${courseId}:${orderBy}:${limit}`
export const courseMembersPrefix = (courseId: string) =>
  `${COURSE_MEMBERS_NS}:${courseId}:`

// GHL calendar availability for a calendar+date combination.
export const ghlSlotsKey = (calendarId: string, date: string) =>
  `${GHL_SLOTS_NS}:${calendarId}:${date}`
export const ghlSlotsPrefix = (calendarId: string, date: string) =>
  `${GHL_SLOTS_NS}:${calendarId}:${date}`
