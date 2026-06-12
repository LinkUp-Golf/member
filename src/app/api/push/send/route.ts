export const dynamic = 'force-dynamic'

// ============================================================
// POST /api/push/send  — send to a single known subscription
//
// Used by the hook's sendTestNotification() and by any server
// code that has the full subscription object available.
//
// Security: caller must be the subscription owner OR an admin.
// Rate-limited to 10 requests per minute per user.
// ============================================================

import type { NextRequest } from 'next/server'
import { NextResponse }     from 'next/server'
import { cookies }          from 'next/headers'
import { createRouteHandlerClient } from '@/lib/supabase-server'
import { sendToSubscription }       from '@/lib/push/pushService'
import { pushSendRateLimit }        from '@/lib/rateLimit'
import type { SendBody, ValidationResult } from '@/lib/push/types'

// ---- Validation --------------------------------------------

const ENDPOINT_RE   = /^https:\/\//i
const MAX_TITLE_LEN = 100
const MAX_BODY_LEN  = 300

function validateBody(body: unknown): ValidationResult {
  if (typeof body !== 'object' || body === null) {
    return { valid: false, errors: ['Body must be a JSON object'] }
  }
  const b = body as Record<string, unknown>
  const errors: string[] = []

  if (typeof b.endpoint !== 'string' || !ENDPOINT_RE.test(b.endpoint)) {
    errors.push('endpoint must be a valid HTTPS URL')
  }
  if (typeof b.p256dh !== 'string' || !b.p256dh) {
    errors.push('p256dh is required')
  }
  if (typeof b.auth !== 'string' || !b.auth) {
    errors.push('auth is required')
  }

  const n = b.notification
  if (typeof n !== 'object' || n === null) {
    errors.push('notification must be an object')
  } else {
    const notif = n as Record<string, unknown>
    if (typeof notif.title !== 'string' || !notif.title.trim()) {
      errors.push('notification.title is required')
    } else if (notif.title.length > MAX_TITLE_LEN) {
      errors.push(`notification.title must be ≤ ${MAX_TITLE_LEN} characters`)
    }
    if (typeof notif.body !== 'string' || !notif.body.trim()) {
      errors.push('notification.body is required')
    } else if (notif.body.length > MAX_BODY_LEN) {
      errors.push(`notification.body must be ≤ ${MAX_BODY_LEN} characters`)
    }
  }

  return { valid: errors.length === 0, errors }
}

export async function POST(request: NextRequest) {
  const cookieStore = cookies()
  const supabase    = createRouteHandlerClient(cookieStore)
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  // Rate limit by user ID
  const rl = pushSendRateLimit(user.id)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Try again later.' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) },
      }
    )
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

  const { endpoint, p256dh, auth, notification } = body as SendBody

  try {
    const result = await sendToSubscription(endpoint, p256dh, auth, notification)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[push/send] error', err)
    return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 })
  }
}
