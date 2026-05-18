// ============================================================
// GET /api/auth/callback
// Magic link redirect handler — two-phase validation:
//
//  Phase 1 — AUTHENTICATION: Exchange code for Supabase session.
//  Phase 2 — AUTHORIZATION:  Verify GHL membership tag is still
//             active. If not, destroy the session immediately and
//             redirect to /membership-required.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createRouteHandlerClient, createAdminClient } from '@/lib/supabase-server'
import { getContactByEmail, contactHasTag } from '@/lib/ghl'
import { cookies } from 'next/headers'
import { logger, auditLog } from '@/lib/logger'
import { COURSE_TAG_MAP, hasAnyAccessTag } from '@/lib/ghl-tags'

export async function GET(request: NextRequest) {
  const requestId = randomUUID()
  const reqLog = logger.child({ requestId, action: 'auth_callback' })

  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const next = requestUrl.searchParams.get('next') ?? '/home'

  if (!code) {
    reqLog.warn('No code in callback URL')
    return NextResponse.redirect(new URL('/auth/error?reason=no_code', request.url))
  }

  const cookieStore = cookies()
  const supabase = createRouteHandlerClient(cookieStore)

  // ---- Phase 1: Exchange code → Supabase session -------------
  const { data: { user }, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error || !user || !user.email) {
    reqLog.warn('Session exchange failed', { errorMessage: error?.message })
    return NextResponse.redirect(new URL('/auth/error?reason=invalid_code', request.url))
  }

  reqLog.info('Session established', { userId: user.id })

  // ---- Phase 2: GHL membership authorization -----------------
  const contact = await getContactByEmail(user.email)
  const authorized = contact ? hasAnyAccessTag(contact.tags ?? []) : false

  if (!authorized) {
    reqLog.warn('GHL auth failed at callback — destroying session', {
      userId: user.id,
      metadata: { hasContact: !!contact },
    })
    auditLog('LOGIN_DENIED', {
      requestId,
      userId: user.id,
      metadata: { reason: 'ghl_tag_missing_at_callback', hasContact: !!contact },
    })
    await supabase.auth.signOut()
    return NextResponse.redirect(new URL('/membership-required', request.url))
  }

  // ---- Sync member record ------------------------------------
  await syncMemberFromGHL(user.id, user.email, contact, requestId)

  auditLog('LOGIN_SUCCESS', {
    requestId,
    userId: user.id,
    ghlContactId: contact?.id,
    metadata: { method: 'magic_link_callback' },
  })

  return NextResponse.redirect(new URL(next, request.url))
}

// ---- Sync GHL contact data into Supabase --------------------

async function syncMemberFromGHL(
  userId: string,
  email: string,
  contact: Awaited<ReturnType<typeof getContactByEmail>>,
  requestId: string
) {
  if (!contact) return

  const log = logger.child({ requestId, userId, action: 'ghl_sync' })
  const adminSupabase = createAdminClient()

  try {
    const activeTags = Object.keys(COURSE_TAG_MAP).filter(tag => contactHasTag(contact, tag))
    if (activeTags.length === 0) return

    const firstTag = activeTags[0]
    if (!firstTag) return
    const homeCourseSlug = (COURSE_TAG_MAP as Record<string, string>)[firstTag]
    if (!homeCourseSlug) return

    const { data: homeCourse } = await adminSupabase
      .from('courses').select('id').eq('slug', homeCourseSlug).single()

    if (!homeCourse) return

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
      }, { onConflict: 'id' })

    if (memberError) {
      log.error('Member upsert error', { errorMessage: memberError.message })
      return
    }

    for (const tag of activeTags) {
      const courseSlug = (COURSE_TAG_MAP as Record<string, string>)[tag]
      if (!courseSlug) continue
      const { data: course } = await adminSupabase
        .from('courses').select('id').eq('slug', courseSlug).single()

      if (course) {
        await adminSupabase
          .from('course_memberships')
          .upsert({
            member_id: userId,
            course_id: course.id,
            access_type: course.id === homeCourse.id ? 'home' : 'guest',
            status: 'active',
          }, { onConflict: 'member_id,course_id,access_type' })
      }
    }

    log.info('GHL sync complete')
  } catch (err) {
    log.error('GHL sync failed (non-fatal)', { errorMessage: String(err) })
  }
}
