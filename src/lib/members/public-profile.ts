// ============================================================
// What one member may see of another — the shape GET /api/members/[id]
// returns. Pure, so the rule is tested directly
// (src/__tests__/public-profile.test.ts).
//
// The route reads with the service role, which bypasses RLS, so this is the
// only thing standing between the members table and another member's browser.
// It used to return the whole row: email, phone, GHL tags, admin flag,
// membership status, a handicap the member had chosen to hide, and every
// detail of a profile the member had hidden. None of it was on screen, but all
// of it was in the response.
//
// So the columns are listed, not starred: a column added to members or
// member_profiles later stays private until someone adds it here on purpose.
// ============================================================

/** The columns read. Everything the profile page and profile sheet show, plus the two switches that decide what's shown. */
export const PUBLIC_MEMBER_SELECT =
  'id, first_name, last_name, ' +
  'profile:member_profiles(' +
    'display_name, avatar_url, business_name, role_title, industry_category, business_description, ' +
    'value_offered, value_sought, non_golf_hobbies, nonprofits, linkedin_url, ' +
    'handicap_index, show_handicap, preferred_play_times, play_frequency, open_to_golf_travel, ' +
    'profile_visible' +
  '), ' +
  'home_course:courses!members_home_course_id_fkey(id, name, city)'

export interface PublicProfileRow {
  id: string
  first_name: string | null
  last_name: string | null
  profile: Record<string, unknown> | Record<string, unknown>[] | null
  home_course: Record<string, unknown> | Record<string, unknown>[] | null
}

export interface PublicMember {
  id: string
  first_name: string
  last_name: string
  profile: Record<string, unknown> | null
  home_course: Record<string, unknown> | null
}

const one = <T>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v)

/**
 * The member as `viewer` may see them.
 *
 * - The member themselves and admins see the whole public profile, including a
 *   handicap the member hides from others.
 * - Anyone else gets the handicap only when the member shows it, and nothing
 *   beyond the name when the member has hidden their profile: the name is
 *   still needed wherever they appear (a tee sheet, a message).
 */
export function publicMember(row: PublicProfileRow, viewer: { isSelf: boolean; isAdmin: boolean }): PublicMember {
  const seesAll = viewer.isSelf || viewer.isAdmin
  const raw = one(row.profile)
  const base = {
    id: row.id,
    first_name: row.first_name ?? '',
    last_name: row.last_name ?? '',
    home_course: one(row.home_course),
  }

  if (!raw) return { ...base, profile: null }
  if (!seesAll && raw.profile_visible === false) return { ...base, profile: null }

  const profile = { ...raw }
  if (!seesAll && profile.show_handicap !== true) profile.handicap_index = null
  return { ...base, profile }
}
