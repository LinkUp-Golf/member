// ============================================================
// POST /api/auth/magic-link (hardened)
// Rate limited · input validated · generic responses
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getContactByEmail, contactHasTag } from '@/lib/ghl'
import { authRateLimit } from '@/lib/rateLimit'
import { validateEmail } from '@/lib/validation'

const COURSE_ACCESS_TAGS = ['avi-active'] as const
const GENERIC_RESPONSE = {
  message: 'If that email is registered with LinkUp Golf, you will receive a login link shortly.',
}

export async function POST(request: NextRequest) {
  // Rate limit by IP — 5 attempts per 15 minutes
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? request.headers.get('x-real-ip') ?? 'unknown'

  const limit = authRateLimit(ip)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many login attempts. Please wait 15 minutes before trying again.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((limit.resetAt - Date.now()) / 1000)) } }
    )
  }

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const { email } = body as Record<string, unknown>
  const emailResult = validateEmail(email)
  if (!emailResult.valid) {
    return NextResponse.json({ error: emailResult.errors[0] }, { status: 400 })
  }

  const normalizedEmail = (email as string).toLowerCase().trim()

  try {
    const contact = await getContactByEmail(normalizedEmail)
    const hasAccess = contact
      ? COURSE_ACCESS_TAGS.some(tag => contactHasTag(contact, tag))
      : false

    if (!hasAccess) return NextResponse.json(GENERIC_RESPONSE)

    const supabase = createAdminClient()
    await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: normalizedEmail,
      options: { redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback` },
    })

    return NextResponse.json(GENERIC_RESPONSE)
  } catch (err) {
    console.error('Auth route error:', err)
    return NextResponse.json(GENERIC_RESPONSE)
  }
}
