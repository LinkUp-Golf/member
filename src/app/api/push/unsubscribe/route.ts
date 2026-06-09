export const dynamic = 'force-dynamic'

// ============================================================
// POST /api/push/unsubscribe  — remove a push subscription
//
// The browser calls this after successfully unsubscribing via
// PushManager.unsubscribe().  We locate the row by endpoint
// and user_id so an attacker cannot unsubscribe arbitrary
// users by guessing endpoints.
// ============================================================

import type { NextRequest } from 'next/server'
import { NextResponse }     from 'next/server'
import { cookies }          from 'next/headers'
import { createRouteHandlerClient } from '@/lib/supabase-server'
import { deleteSubscription }       from '@/lib/push/subscriptionRepository'
import type { ValidationResult }    from '@/lib/push/types'

const ENDPOINT_RE = /^https:\/\//i

function validateBody(body: unknown): ValidationResult {
  if (typeof body !== 'object' || body === null) {
    return { valid: false, errors: ['Body must be a JSON object'] }
  }
  const b = body as Record<string, unknown>
  if (typeof b.endpoint !== 'string' || !ENDPOINT_RE.test(b.endpoint)) {
    return { valid: false, errors: ['endpoint must be a valid HTTPS URL'] }
  }
  return { valid: true, errors: [] }
}

export async function POST(request: NextRequest) {
  const cookieStore = cookies()
  const supabase    = createRouteHandlerClient(cookieStore)
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const validation = validateBody(body)
  if (!validation.valid) {
    return NextResponse.json(
      { error: 'Validation failed', details: validation.errors },
      { status: 400 }
    )
  }

  const { endpoint } = body as { endpoint: string }

  try {
    await deleteSubscription(endpoint, user.id)
    return NextResponse.json({ unsubscribed: true })
  } catch (err) {
    console.error('[push/unsubscribe] error', err)
    return NextResponse.json({ error: 'Failed to remove subscription' }, { status: 500 })
  }
}
