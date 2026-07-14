export const dynamic = 'force-dynamic'

// ============================================================
// GET /auth/confirm?token_hash=...&type=email
// Handler for admin-GENERATED copy-paste login links
// (see /api/admin/magic-link/generate).
//
// Authenticates via verifyOtp(token_hash) rather than the PKCE
// code exchange used by /api/auth/callback — admin-generated links
// have no browser-stored code_verifier, so the code flow can't work.
// This is the same token_hash primitive the returning-member login
// already relies on (login page verifyOtp).
//
// Phase 2 (GHL membership + suspension gate) intentionally mirrors
// src/app/api/auth/callback/route.ts — keep the two in sync. The
// existing callback is deliberately left untouched.
// ============================================================

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import type { EmailOtpType } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { createRouteHandlerClient, createAdminClient } from '@/lib/supabase-server'
import { getContactByEmail } from '@/lib/ghl/client'
import { hasAnyAccessTag } from '@/lib/ghl/tags'
import { syncMember } from '@/lib/sync'
import { safeRedirectPath } from '@/lib/utils'
import { logger, auditLog } from '@/lib/logger'

export async function GET(request: NextRequest) {
  const requestId = randomUUID()
  const reqLog = logger.child({ requestId, action: 'auth_confirm' })

  const url = new URL(request.url)
  const tokenHash = url.searchParams.get('token_hash')
  // Whitelist the OTP type rather than trusting the query string — prevents
  // /auth/confirm from being used as a verification oracle for other OTP
  // types (recovery, email_change, …). Magic-link tokens verify as 'email'.
  const rawType = url.searchParams.get('type')
  const type: EmailOtpType = rawType === 'magiclink' ? 'magiclink' : 'email'
  const next = safeRedirectPath(url.searchParams.get('next'))

  if (!tokenHash) {
    reqLog.warn('No token_hash in confirm URL')
    return NextResponse.redirect(new URL('/auth/error?reason=no_code', request.url))
  }

  const cookieStore = cookies()
  const supabase = createRouteHandlerClient(cookieStore)

  // ---- Phase 1: verify token_hash → Supabase session ----------
  const { data: { user }, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })

  if (error || !user || !user.email) {
    reqLog.warn('OTP verification failed', { errorMessage: error?.message })
    return NextResponse.redirect(new URL('/auth/error?reason=invalid_code', request.url))
  }

  reqLog.info('Session established', { userId: user.id })

  // ---- Phase 2: GHL membership authorization -----------------
  const contact = await getContactByEmail(user.email)
  const authorized = contact ? hasAnyAccessTag(contact.tags ?? []) : false

  if (!authorized) {
    reqLog.warn('GHL auth failed at confirm — destroying session', {
      userId: user.id,
      metadata: { hasContact: !!contact },
    })
    auditLog('LOGIN_DENIED', {
      requestId,
      userId: user.id,
      metadata: { reason: 'ghl_tag_missing_at_confirm', hasContact: !!contact },
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
    .select('membership_status')
    .eq('id', user.id)
    .maybeSingle()

  if (memberRecord?.membership_status === 'suspended') {
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
    metadata: { method: 'magic_link_confirm' },
  })

  return NextResponse.redirect(new URL(next, request.url))
}
