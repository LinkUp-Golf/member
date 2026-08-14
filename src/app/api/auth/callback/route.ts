export const dynamic = 'force-dynamic'

// ============================================================
// GET /api/auth/callback
// Magic link redirect handler — two-phase validation:
//
//  Phase 1 — AUTHENTICATION: Exchange code for Supabase session.
//  Phase 2 — AUTHORIZATION:  Verify GHL membership tag is still
//             active. If not, destroy the session immediately and
//             redirect to /membership-required.
// ============================================================

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createRouteHandlerClient, createAdminClient } from '@/lib/supabase-server'
import { getContactByEmail } from '@/lib/ghl/client'
import { hasAnyAccessTag, hasPartnerTag, hasHostTag } from '@/lib/ghl/tags'
import { workspaceLandingPath } from '@/lib/auth/landing'
import { syncMember } from '@/lib/sync'
import { safeRedirectPath } from '@/lib/utils'
import { cookies } from 'next/headers'
import { logger, auditLog } from '@/lib/logger'

export async function GET(request: NextRequest) {
  const requestId = randomUUID()
  const reqLog = logger.child({ requestId, action: 'auth_callback' })

  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const next = safeRedirectPath(requestUrl.searchParams.get('next'))

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

  // ---- Sync member record + stamp last_sign_in ---------------
  const adminClient = createAdminClient()
  if (contact) {
    await syncMember({
      contact,
      userId: user.id,
      ctx: { supabase: adminClient, requestId },
    })
  }

  // ---- Suspension check --------------------------------------
  const { data: memberRecord } = await adminClient
    .from('members')
    .select('membership_status, home_course_id')
    .eq('id', user.id)
    .maybeSingle()

  // A role tag (referral-partner / host) grants access independent of golf
  // membership status, so it overrides a 'suspended' membership at login too.
  const tags = contact?.tags ?? []
  const hasRole = hasPartnerTag(tags) || hasHostTag(tags)

  if (memberRecord?.membership_status === 'suspended' && !hasRole) {
    reqLog.warn('Suspended member attempted login — destroying session', { userId: user.id })
    auditLog('LOGIN_DENIED', { requestId, userId: user.id, metadata: { reason: 'account_suspended' } })
    await supabase.auth.signOut()
    return NextResponse.redirect(new URL('/auth/error?reason=suspended', request.url))
  }

  await adminClient
    .from('members')
    .update({ last_sign_in: new Date().toISOString() })
    .eq('id', user.id)

  auditLog('LOGIN_SUCCESS', {
    requestId,
    userId: user.id,
    ghlContactId: contact?.id,
    metadata: { method: 'magic_link_callback' },
  })

  // A non-member (no home course) has no member app to land on — send them to
  // their workspace rather than the default landing page. An explicit workspace
  // `next` is honoured.
  if (!memberRecord?.home_course_id && !next.startsWith('/partner') && !next.startsWith('/host')) {
    const dest = await workspaceLandingPath(adminClient, user.id)
    if (dest) return NextResponse.redirect(new URL(dest, request.url))
  }

  return NextResponse.redirect(new URL(next, request.url))
}
