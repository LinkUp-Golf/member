export const dynamic = 'force-dynamic'

// ============================================================
// POST /api/admin/magic-link/generate   { email }  ->  { link }
// Generates (but does NOT email) a copy-paste login link for an
// arbitrary email. The returned link points at /auth/confirm and
// carries a single-use token_hash.
//
// Provisions a Supabase auth user if none exists yet (common for
// people not in the app). The GHL membership gate at /auth/confirm
// still governs whether the recipient can actually complete sign-in.
// ============================================================

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { magicLinkSendRateLimit } from '@/lib/rateLimit'
import { validateEmail } from '@/lib/validation'
import { logger } from '@/lib/logger'
import type { AuthContext } from '@/lib/auth/types'

export const POST = withAuth(
  async (req: NextRequest, ctx: AuthContext) => {
    const body = await req.json().catch(() => ({}))
    const { email } = body as { email?: unknown }

    const check = validateEmail(email)
    if (!check.valid) {
      return NextResponse.json({ error: check.errors[0] }, { status: 400 })
    }

    const normalizedEmail = (email as string).toLowerCase().trim()

    // A shareable link is a credential — the same abuse surface as a send.
    const rl = magicLinkSendRateLimit(normalizedEmail)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many login-link requests for this address. Please wait before trying again.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
      )
    }

    // Build the absolute link up front — a relative link is useless to copy,
    // so fail loudly on misconfiguration rather than emitting a broken URL.
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
    if (!appUrl) {
      logger.error('NEXT_PUBLIC_APP_URL not set — cannot build a shareable login link', {
        action: 'members.magic_link.misconfigured',
        userId: ctx.userId,
      })
      return NextResponse.json({ error: 'Server is not configured to generate links.' }, { status: 500 })
    }

    const admin = createAdminClient()

    const { data: existing, error: lookupError } = await admin
      .from('members')
      .select('membership_status')
      .eq('email', normalizedEmail)
      .maybeSingle()

    // Fail closed — if we can't determine membership status, don't mint a link.
    if (lookupError) {
      logger.error('Admin magic-link member lookup failed', {
        action: 'members.magic_link.lookup_failed',
        userId: ctx.userId,
        metadata: { error: lookupError.message },
      })
      return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
    }

    if (existing?.membership_status === 'suspended') {
      return NextResponse.json(
        { error: 'Cannot generate a login link for a suspended member.' },
        { status: 400 }
      )
    }

    const generate = () =>
      admin.auth.admin.generateLink({ type: 'magiclink', email: normalizedEmail })

    let { data, error } = await generate()

    // No auth user yet (common for people not in the app) — provision one
    // (email confirmed, no password; they authenticate via the link), then retry.
    if (error || !data?.properties?.hashed_token) {
      const { error: createError } = await admin.auth.admin.createUser({
        email: normalizedEmail,
        email_confirm: true,
      })
      // "already registered" means the user exists and the first generate()
      // failed for another reason — retry is still valid. Any other createUser
      // failure is genuine: surface it instead of masking it behind the retry.
      if (createError && !/already|registered|exists/i.test(createError.message)) {
        logger.error('Admin magic-link user provisioning failed', {
          action: 'members.magic_link.provision_failed',
          userId: ctx.userId,
          metadata: { error: createError.message },
        })
        return NextResponse.json({ error: 'Failed to generate login link.' }, { status: 500 })
      }
      ;({ data, error } = await generate())
    }

    if (error || !data?.properties?.hashed_token) {
      logger.error('Admin magic-link generate failed', {
        action: 'members.magic_link.generate_failed',
        userId: ctx.userId,
        metadata: { error: error?.message },
      })
      return NextResponse.json({ error: 'Failed to generate login link.' }, { status: 500 })
    }

    const tokenHash = encodeURIComponent(data.properties.hashed_token)
    const link = `${appUrl}/auth/confirm?token_hash=${tokenHash}&type=email`

    try {
      await admin.from('admin_audit_log').insert({
        admin_id: ctx.userId,
        action: 'members.magic_link.generated',
        target_type: 'email',
        target_id: normalizedEmail,
        payload: { email: normalizedEmail },
      })
    } catch { /* table may not exist yet */ }

    return NextResponse.json({ link })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
