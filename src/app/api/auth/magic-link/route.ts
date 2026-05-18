import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { cookies } from 'next/headers'
import { createRouteHandlerClient } from '@/lib/supabase-server'
import { getContactByEmail } from '@/lib/ghl'
import { authRateLimit } from '@/lib/rateLimit'
import { validateEmail } from '@/lib/validation'
import { logger, auditLog } from '@/lib/logger'
import { hasAnyAccessTag } from '@/lib/ghl-tags'

// Intentionally vague — prevents email enumeration
const GENERIC_RESPONSE = {
  message: 'If that email is registered with LinkUp Golf, you will receive a login link shortly.',
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID()
  const reqLog = logger.child({ requestId, action: 'magic_link_request' })

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
    const contact = await getContactByEmail(normalizedEmail)
    const hasAccess = contact ? hasAnyAccessTag(contact.tags ?? []) : false

    auditLog('LOGIN_ATTEMPT', { requestId, metadata: { hasAccess, hasContact: !!contact } })

    if (!hasAccess) {
      auditLog('LOGIN_DENIED', { requestId, metadata: { reason: 'no_ghl_tag' } })
      return NextResponse.json(GENERIC_RESPONSE, { headers: { 'X-Request-Id': requestId } })
    }

    // Use route handler client (not admin) so Supabase can store the
    // PKCE code_verifier in a cookie — required for exchangeCodeForSession
    // in the callback route.
    const supabase = createRouteHandlerClient(cookies())
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: normalizedEmail,
      options: {
        emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback`,
        shouldCreateUser: true,
      },
    })

    if (otpError) {
      reqLog.error('Failed to send magic link', { errorMessage: otpError.message })
      return NextResponse.json(
        { error: 'Failed to send login link. Please try again.' },
        { status: 500, headers: { 'X-Request-Id': requestId } }
      )
    }

    auditLog('LOGIN_SUCCESS', { requestId, ghlContactId: contact?.id, metadata: { method: 'magic_link' } })
    return NextResponse.json(GENERIC_RESPONSE, { headers: { 'X-Request-Id': requestId } })
  } catch (err) {
    reqLog.error('Unexpected error', { errorMessage: String(err) })
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500, headers: { 'X-Request-Id': requestId } }
    )
  }
}
