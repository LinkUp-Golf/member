// ============================================================
// POST /api/auth/magic-link
// GHL membership gate only — does NOT send the magic link.
//
// Returns { allowed: true } when the email has an active GHL
// membership tag. The login page then calls Supabase signInWithOtp
// client-side so the PKCE code_verifier is stored in the browser
// (its correct location), not in a server-side cookie.
// ============================================================

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getContactByEmail } from '@/lib/ghl/client'
import { authRateLimit } from '@/lib/rateLimit'
import { validateEmail } from '@/lib/validation'
import { logger, auditLog } from '@/lib/logger'
import { hasAnyAccessTag } from '@/lib/ghl/tags'
import { createAdminClient } from '@/lib/supabase-server'

// Intentionally vague — prevents email enumeration
const GENERIC_OK = { allowed: true }
const GENERIC_DENY = { allowed: false }

export async function POST(request: NextRequest) {
  const requestId = randomUUID()
  const reqLog = logger.child({ requestId, action: 'magic_link_gate' })

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? request.headers.get('x-real-ip')
    ?? 'unknown'

  const limit = authRateLimit(ip)
  if (!limit.allowed) {
    reqLog.warn('Rate limit hit', { metadata: { ip } })
    return NextResponse.json(
      { error: 'Too many login attempts. Please wait before trying again.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((limit.resetAt - Date.now()) / 1000)), 'X-Request-Id': requestId } }
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400, headers: { 'X-Request-Id': requestId } })
  }

  const { email } = body as Record<string, unknown>
  const emailResult = validateEmail(email)
  if (!emailResult.valid) {
    return NextResponse.json({ error: emailResult.errors[0] }, { status: 400, headers: { 'X-Request-Id': requestId } })
  }

  const normalizedEmail = (email as string).toLowerCase().trim()

  try {
    const adminClient = createAdminClient()

    // ---- Returning member check ---------------------------------
    // A row in members means this email has completed the full auth
    // flow at least once (magic link click → callback → syncMember).
    // Skip the GHL gate and generate a silent OTP — no email sent.
    const { data: existingMember } = await adminClient
      .from('members')
      .select('id')
      .eq('email', normalizedEmail)
      .maybeSingle()

    if (existingMember) {
      const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
        type: 'magiclink',
        email: normalizedEmail,
      })

      if (!linkError && linkData?.properties?.hashed_token) {
        auditLog('SILENT_LOGIN', { requestId, metadata: { method: 'returning_member' } })
        return NextResponse.json(
          { returning: true, token_hash: linkData.properties.hashed_token },
          { headers: { 'X-Request-Id': requestId } }
        )
      }

      // generateLink failed unexpectedly — fall through to normal flow
      reqLog.warn('generateLink failed for returning member, falling through', { errorMessage: linkError?.message })
    }

    // ---- New user: GHL membership gate -------------------------
    const contact = await getContactByEmail(normalizedEmail)
    const hasAccess = contact ? hasAnyAccessTag(contact.tags ?? []) : false

    auditLog('LOGIN_ATTEMPT', { requestId, metadata: { hasAccess, hasContact: !!contact } })

    if (!hasAccess) {
      auditLog('LOGIN_DENIED', { requestId, metadata: { reason: 'no_ghl_tag' } })
      return NextResponse.json(GENERIC_DENY, { headers: { 'X-Request-Id': requestId } })
    }

    auditLog('LOGIN_SUCCESS', { requestId, ghlContactId: contact?.id, metadata: { method: 'magic_link_gate' } })
    return NextResponse.json(GENERIC_OK, { headers: { 'X-Request-Id': requestId } })
  } catch (err) {
    reqLog.error('Unexpected error', { errorMessage: String(err) })
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500, headers: { 'X-Request-Id': requestId } }
    )
  }
}
