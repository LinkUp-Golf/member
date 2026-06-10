export const dynamic = 'force-dynamic'

// ============================================================
// GET  /api/push/subscribe  — return public VAPID key
// POST /api/push/subscribe  — register / refresh a subscription
// ============================================================

import type { NextRequest } from 'next/server'
import { NextResponse }     from 'next/server'
import { cookies }          from 'next/headers'
import { createRouteHandlerClient } from '@/lib/supabase-server'
import { upsertSubscription, claimAnonymousSubscriptions } from '@/lib/push/subscriptionRepository'
import type { SubscribeBody, ValidationResult } from '@/lib/push/types'

// ---- Validation --------------------------------------------

const ENDPOINT_RE = /^https:\/\//i

function validateSubscribeBody(body: unknown): ValidationResult {
  if (typeof body !== 'object' || body === null) {
    return { valid: false, errors: ['Request body must be a JSON object'] }
  }
  const b = body as Record<string, unknown>
  const errors: string[] = []

  if (typeof b.endpoint !== 'string' || !ENDPOINT_RE.test(b.endpoint)) {
    errors.push('endpoint must be a valid HTTPS URL')
  }
  if (b.endpoint && (b.endpoint as string).length > 500) {
    errors.push('endpoint is too long')
  }

  const keys = b.keys
  if (typeof keys !== 'object' || keys === null) {
    errors.push('keys must be an object with p256dh and auth fields')
  } else {
    const k = keys as Record<string, unknown>
    if (typeof k.p256dh !== 'string' || !k.p256dh) {
      errors.push('keys.p256dh is required')
    }
    if (typeof k.auth !== 'string' || !k.auth) {
      errors.push('keys.auth is required')
    }
  }

  return { valid: errors.length === 0, errors }
}

// ---- GET: return public VAPID key --------------------------

export async function GET() {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  if (!key) {
    return NextResponse.json(
      { error: 'Push notifications are not configured on this server' },
      { status: 503 }
    )
  }
  return NextResponse.json({ publicKey: key })
}

// ---- POST: register / refresh subscription -----------------

export async function POST(request: NextRequest) {
  // Authenticate — may be null for anonymous sessions that
  // don't have a Supabase auth token yet.
  const cookieStore = cookies()
  const supabase    = createRouteHandlerClient(cookieStore)
  const { data: { user } } = await supabase.auth.getUser()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const validation = validateSubscribeBody(body)
  if (!validation.valid) {
    return NextResponse.json(
      { error: 'Validation failed', details: validation.errors },
      { status: 400 }
    )
  }

  const payload = body as SubscribeBody
  const userId  = user?.id ?? null

  try {
    await upsertSubscription(payload, userId)

    // If the user is now authenticated and this endpoint was
    // previously stored anonymously, claim it.
    if (userId) {
      await claimAnonymousSubscriptions([payload.endpoint], userId)
    }

    return NextResponse.json({ subscribed: true }, { status: 200 })
  } catch (err) {
    console.error('[push/subscribe] upsert error', err)
    return NextResponse.json({ error: 'Failed to save subscription' }, { status: 500 })
  }
}
