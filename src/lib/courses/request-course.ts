// Shared logic for a member/host proposing a golf club that isn't yet on LinkUp.
// Creates a `pending` course (requested_by = the member) that lands in the admin
// golf-events "Pending" queue. Placeholder empty strings satisfy the courses
// NOT NULL columns (city/state/access_tag); the admin supplies the real values,
// calendar, logo and payment link on approval.

import type { SupabaseClient } from '@supabase/supabase-js'

export interface RequestedCourse {
  id: string
  name: string
  city: string
  approval_status: string
}

export interface RequestCourseResult {
  course?: RequestedCourse
  /** True when an identical pending course already existed and was reused. */
  alreadyRequested?: boolean
  error?: string
  status?: number
}

function toSlug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export async function requestPendingCourse(params: {
  admin: SupabaseClient
  name: string
  /** Optional club website, stored as the course's booking_url. */
  website?: string | null
  /** members.id of the requester. */
  requestedBy: string
}): Promise<RequestCourseResult> {
  const { admin, requestedBy } = params
  const name = params.name.trim()
  const website = params.website?.trim() || null

  const baseSlug = toSlug(name)
  if (!baseSlug) return { error: 'Enter a valid golf club name', status: 400 }

  // Reuse an existing course with the same slug rather than creating a duplicate.
  const { data: existing } = await admin
    .from('courses')
    .select('id, name, city, approval_status')
    .eq('slug', baseSlug)
    .maybeSingle()

  if (existing) {
    if (existing.approval_status === 'active') {
      return { error: 'That club is already on LinkUp — pick it from the list.', status: 409 }
    }
    if (existing.approval_status === 'pending') {
      // Already queued (possibly by someone else) — reuse it so callers can
      // attach to the same pending course without creating a duplicate row.
      return { course: existing as RequestedCourse, alreadyRequested: true }
    }
    // rejected / archived: fall through and create a fresh request below.
  }

  // A rejected/archived course may still hold the base slug, so keep it unique.
  const slug = existing ? `${baseSlug}-${Date.now().toString(36).slice(-4)}` : baseSlug

  const { data, error } = await admin
    .from('courses')
    .insert({
      name,
      slug,
      city: '',
      state: '',
      access_tag: '',
      booking_url: website,
      approval_status: 'pending',
      requested_by: requestedBy,
    })
    .select('id, name, city, approval_status')
    .single()

  if (error) {
    if (error.code === '23505') return { error: 'That club has already been requested.', status: 409 }
    return { error: error.message, status: 500 }
  }

  return { course: data as RequestedCourse }
}
