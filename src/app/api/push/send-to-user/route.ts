export const dynamic = 'force-dynamic'

// ============================================================
// POST /api/push/send-to-user  — send to all subscriptions of
// a specific user.
//
// Admin-only: caller must have is_admin = true.
// Rate-limited to 10 requests per minute per admin.
// ============================================================

import type { NextRequest } from 'next/server'
import { NextResponse }     from 'next/server'
import { cookies }          from 'next/headers'
import { createRouteHandlerClient, createAdminClient } from '@/lib/supabase-server'
import { sendToUser }          from '@/lib/push/pushService'
import { pushSendRateLimit }   from '@/lib/rateLimit'
import type { SendToUserBody, ValidationResult } from '@/lib/push/types'

const UUID_RE       = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_TITLE_LEN = 100
const MAX_BODY_LEN  = 300

function validateBody(body: unknown): ValidationResult {
  if (typeof body !== 'object' || body === null) {
    return { valid: false, errors: ['Body must be a JSON object'] }
  }
  const b = body as Record<string, unknown>
  const errors: string[] = []

  if (typeof b.userId !== 'string' || !UUID_RE.test(b.userId)) {
    errors.push('userId must be a valid UUID')
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

async function isAdmin(userId: string): Promise<boolean> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('members')
    .select('is_admin')
    .eq('id', userId)
    .single()
  return data?.is_admin === true
}

export async function POST(request: NextRequest) {
  const cookieStore = cookies()
  const supabase    = createRouteHandlerClient(cookieStore)
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const admin = await isAdmin(user.id)
  if (!admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

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

  const { userId, notification } = body as SendToUserBody

  try {
    const result = await sendToUser(userId, notification)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[push/send-to-user] error', err)
    return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 })
  }
}
