export const dynamic = 'force-dynamic'

// GET  /api/host/application — the caller's application status, plus their host
//        row once approved.
// POST /api/host/application — apply to become a host.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { validateHostApplicationPayload, sanitiseText } from '@/lib/validation'
import { logger } from '@/lib/logger'
import type { AuthContext } from '@/lib/auth/types'

export const GET = withAuth(async (_req: NextRequest, ctx: AuthContext) => {
  const admin = createAdminClient()

  // Most recent application — the member may have been rejected and re-applied.
  const { data: application } = await admin
    .from('host_applications')
    .select('*')
    .eq('member_id', ctx.memberId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // The host row is the role itself, so report it independently of the
  // application — an admin can grant the role without an application existing.
  const { data: host } = await admin
    .from('hosts')
    .select('id, name, status')
    .eq('member_id', ctx.memberId)
    .maybeSingle()

  return NextResponse.json({ application: application ?? null, host: host ?? null })
})

export const POST = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  const body = await req.json().catch(() => ({})) as { name?: string; description?: string }

  const { valid, errors } = validateHostApplicationPayload(body)
  if (!valid) return NextResponse.json({ error: errors[0] }, { status: 400 })

  const name = body.name?.trim() ?? ''
  const description = body.description?.trim() ?? ''

  const admin = createAdminClient()

  // Already a host — nothing to apply for.
  const { data: existingHost } = await admin
    .from('hosts')
    .select('id')
    .eq('member_id', ctx.memberId)
    .maybeSingle()
  if (existingHost) {
    return NextResponse.json({ error: 'You are already a host.' }, { status: 409 })
  }

  // Re-applying while a review is open is a no-op, not a duplicate row. The
  // partial unique index is the race-safe backstop for this check.
  const { data: pending } = await admin
    .from('host_applications')
    .select('id')
    .eq('member_id', ctx.memberId)
    .eq('status', 'pending')
    .maybeSingle()
  if (pending) {
    return NextResponse.json({ error: 'You already have an application under review.' }, { status: 409 })
  }

  const { data, error } = await admin
    .from('host_applications')
    .insert({
      member_id: ctx.memberId,
      name: sanitiseText(name),
      description: sanitiseText(description),
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'You already have an application under review.' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  logger.info('Host application submitted', {
    action: 'host.application.submitted',
    userId: ctx.userId,
    metadata: { application_id: data.id },
  })

  return NextResponse.json({ application: data }, { status: 201 })
})
