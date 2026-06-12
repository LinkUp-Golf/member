export const dynamic = 'force-dynamic'

// ============================================================
// POST /api/push/send-to-all  — broadcast to every subscription
//
// Admin-only.  Strictly rate-limited (2 broadcasts per hour)
// to prevent notification abuse.  Heavy operation — runs
// asynchronously on Vercel via waitUntil-style pattern by
// returning the response before awaiting results.
// ============================================================

import type { NextRequest } from 'next/server'
import { NextResponse }     from 'next/server'
import { cookies }          from 'next/headers'
import { createRouteHandlerClient, createAdminClient } from '@/lib/supabase-server'
import { sendToAll }              from '@/lib/push/pushService'
import { pushSendToAllRateLimit } from '@/lib/rateLimit'
import type { SendToAllBody, ValidationResult } from '@/lib/push/types'

const MAX_TITLE_LEN = 100
const MAX_BODY_LEN  = 300

function validateBody(body: unknown): ValidationResult {
  if (typeof body !== 'object' || body === null) {
    return { valid: false, errors: ['Body must be a JSON object'] }
  }
  const b = body as Record<string, unknown>
  const errors: string[] = []

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
    // Validate optional url to prevent open-redirect injection
    if (notif.url !== undefined) {
      if (typeof notif.url !== 'string') {
        errors.push('notification.url must be a string')
      } else if (!/^\//.test(notif.url as string)) {
        errors.push('notification.url must be a relative path starting with /')
      }
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

  // Strict rate limiting for broadcast
  const rl = pushSendToAllRateLimit(user.id)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Broadcast rate limit exceeded. Maximum 2 broadcasts per hour.' },
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

  const { notification } = body as SendToAllBody

  try {
    // Await the send so we can return accurate stats.
    // For very large subscriber lists (>10k) consider offloading to a queue.
    const result = await sendToAll(notification)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[push/send-to-all] error', err)
    return NextResponse.json({ error: 'Failed to send broadcast' }, { status: 500 })
  }
}
