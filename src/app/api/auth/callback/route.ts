// ============================================================
// GET /auth/callback
// Handles the magic link redirect from Supabase email.
// After authenticating, syncs member data from GHL into
// the local Supabase members table.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient, createAdminClient } from '@/lib/supabase-server'
import { getContactByEmail, contactHasTag } from '@/lib/ghl'
import { cookies } from 'next/headers'

const COURSE_TAG_MAP: Record<string, string> = {
  'avi-active': 'aviara', // GHL tag → course slug
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const next = requestUrl.searchParams.get('next') ?? '/home'

  if (!code) {
    return NextResponse.redirect(new URL('/auth/error?reason=no_code', request.url))
  }

  const cookieStore = cookies()
  const supabase = createRouteHandlerClient(cookieStore)

  // Exchange code for session
  const { data: { user }, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error || !user) {
    console.error('Session exchange error:', error)
    return NextResponse.redirect(new URL('/auth/error?reason=invalid_code', request.url))
  }

  // Sync member data from GHL
  await syncMemberFromGHL(user.id, user.email!)

  return NextResponse.redirect(new URL(next, request.url))
}

// ---- Sync member from GHL -----------------------------------

async function syncMemberFromGHL(userId: string, email: string) {
  const adminSupabase = createAdminClient()

  try {
    // Get GHL contact
    const contact = await getContactByEmail(email)
    if (!contact) return

    // Determine which courses this member has access to
    const activeTags = Object.keys(COURSE_TAG_MAP).filter(tag =>
      contactHasTag(contact, tag)
    )

    if (activeTags.length === 0) return

    // Get the primary home course (first active tag)
    const firstTag = activeTags[0]
    if (!firstTag) return
    const homeCourseSlug = COURSE_TAG_MAP[firstTag]
    if (!homeCourseSlug) return
    const { data: homeCourse } = await adminSupabase
      .from('courses')
      .select('id')
      .eq('slug', homeCourseSlug)
      .single()

    if (!homeCourse) return

    // Upsert the member record
    const { error: memberError } = await adminSupabase
      .from('members')
      .upsert({
        id: userId,
        ghl_contact_id: contact.id,
        email: email.toLowerCase(),
        first_name: contact.firstName ?? '',
        last_name: contact.lastName ?? '',
        phone: contact.phone ?? null,
        home_course_id: homeCourse.id,
        membership_status: 'active',
        ghl_tags: contact.tags ?? [],
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'id',
      })

    if (memberError) {
      console.error('Member upsert error:', memberError)
      return
    }

    // Upsert course memberships for each active tag
    for (const tag of activeTags) {
      const courseSlug = COURSE_TAG_MAP[tag]
      const { data: course } = await adminSupabase
        .from('courses')
        .select('id')
        .eq('slug', courseSlug)
        .single()

      if (course) {
        await adminSupabase
          .from('course_memberships')
          .upsert({
            member_id: userId,
            course_id: course.id,
            access_type: course.id === homeCourse.id ? 'home' : 'guest',
            status: 'active',
          }, {
            onConflict: 'member_id,course_id,access_type',
          })
      }
    }
  } catch (err) {
    // Log but don't block the auth flow
    console.error('GHL sync error during auth callback:', err)
  }
}
