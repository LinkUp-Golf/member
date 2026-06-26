export const dynamic = 'force-dynamic'

// GET /api/courses
// Returns courses the authenticated member can access based on their GHL tags
// matching each course's access_tag or required_tags.

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
    .order('name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Member can access a course if they have the course's access_tag
  // OR at least one of the course's required_tags
  const accessible = (courses ?? []).filter((c: { access_tag: string; required_tags: string[] }) => {
    if (memberTags.includes(c.access_tag)) return true
    if (c.required_tags?.length) {
      return c.required_tags.some((t: string) => memberTags.includes(t))
    }
    return false
  })

  return NextResponse.json({ courses: accessible })
}
