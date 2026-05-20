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
import { getContactByEmail } from '@/lib/ghl/client'
import { hasAnyAccessTag } from '@/lib/ghl/tags'
import { syncMember } from '@/lib/sync'
import { cookies } from 'next/headers'
import { logger, auditLog } from '@/lib/logger'

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

  // ---- Sync member record via shared sync orchestrator -------
  if (contact) {
    await syncMember({
      contact,
      userId: user.id,
      ctx: { supabase: createAdminClient(), requestId },
    })
  }

  auditLog('LOGIN_SUCCESS', {
    requestId,
    userId: user.id,
    ghlContactId: contact?.id,
    metadata: { method: 'magic_link_callback' },
  })

  return NextResponse.redirect(new URL(next, request.url))
}
