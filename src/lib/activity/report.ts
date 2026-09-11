// ============================================================
// Shared constants and helpers for the admin utilization report —
// imported by both the API route and the page, so the roster's
// page-size options and the community labels can't drift between
// what the UI offers and what the server accepts.
// ============================================================

export const PAGE_SIZES = [10, 25, 50, 100] as const
export type PageSize = (typeof PAGE_SIZES)[number]

// The roster opens on the shortest page. It's a list to work through — who
// hasn't used the app, who to follow up — not a table to scan, and a first
// screen that ends where the page does beats one that runs past the fold
// before the admin has read a row.
export const DEFAULT_PAGE_SIZE: PageSize = 10

// ---- Communities --------------------------------------------
// A community is the market a club sits in, not a row in a table of its own:
// the courses that share a "City, State". Derived rather than stored, so
// adding a club in a new city creates its community by existing.

export interface CourseLocation {
  city: string | null
  state: string | null
}

/** The community label for one course. Empty when it has no location on file —
 *  such a course belongs to no community and is filtered out, never grouped
 *  under a blank heading. */
export function communityOf(course: CourseLocation): string {
  return [course.city, course.state].filter(Boolean).join(', ')
}

/** Every community across a set of courses, alphabetically. */
export function communitiesOf(courses: CourseLocation[]): string[] {
  return [...new Set(courses.map(communityOf).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}
