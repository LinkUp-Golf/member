export const dynamic = 'force-dynamic'

// GET /api/courses
// Returns every bookable course (has a GHL calendar + a payment link) —
// visible to all members regardless of GHL tag, but flagged with
// `has_access`/`access_requested` so the client can show a booking flow
// or a "Request Access" CTA in its place.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createRouteHandlerClient, createAdminClient } from '@/lib/supabase-server'

export async function GET(_req: NextRequest) {
  const cookieStore = cookies()
  const supabase = createRouteHandlerClient(cookieStore)

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const admin = createAdminClient()

  const { data: member } = await admin
    .from('members')
    .select('ghl_tags')
    .eq('id', user.id)
    .single()

  const memberTags: string[] = (member?.ghl_tags as string[]) ?? []

  const { data: courses, error } = await admin
    .from('courses')
    .select('*')
    .eq('active', true)
    .eq('approval_status', 'active')
    .not('ghl_calendar_id', 'is', null)  // exclude courses without a GHL calendar
    .not('payment_url', 'is', null)      // exclude courses without a payment link
    .order('name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: pendingRequests } = await admin
    .from('event_access_requests')
    .select('course_id')
    .eq('member_id', user.id)
    .eq('status', 'pending')
  const requestedCourseIds = new Set((pendingRequests ?? []).map(r => r.course_id as string))

  // Member can access a course if they have the course's access_tag
  // OR at least one of the course's required_tags
  const withAccess = (courses ?? []).map((c: { id: string; access_tag: string; required_tags: string[] }) => {
    const hasAccess = memberTags.includes(c.access_tag) ||
      (c.required_tags?.length ? c.required_tags.some((t: string) => memberTags.includes(t)) : false)
    return { ...c, has_access: hasAccess, access_requested: requestedCourseIds.has(c.id) }
  })

  return NextResponse.json({ courses: withAccess })
}
