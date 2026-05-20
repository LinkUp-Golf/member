export const dynamic = 'force-dynamic'

// ============================================================
// POST /api/push/subscribe    — register a push subscription
// DELETE /api/push/subscribe  — unregister a push subscription
// GET /api/push/vapid-key     — return the public VAPID key
// ============================================================

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createRouteHandlerClient } from '@/lib/supabase-server'

// ---- GET: Return public VAPID key ---------------------------
// Client needs this to create a push subscription

export async function GET() {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  if (!key) {
    return NextResponse.json({ error: 'Push notifications not configured' }, { status: 503 })
  }
  return NextResponse.json({ publicKey: key })
}

// ---- POST: Register a new push subscription -----------------

export async function POST(request: NextRequest) {
  const cookieStore = cookies()
  const supabase = createRouteHandlerClient(cookieStore)

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const body = await request.json()
  const { endpoint, keys } = body

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return NextResponse.json({ error: 'Invalid subscription data' }, { status: 400 })
  }

  // Upsert — handles re-subscription after browser reinstall
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert({
      member_id: user.id,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
    }, {
      onConflict: 'endpoint',
    })

  if (error) {
    return NextResponse.json({ error: 'Failed to save subscription' }, { status: 500 })
  }

  return NextResponse.json({ subscribed: true })
}

// ---- DELETE: Remove a push subscription ---------------------

export async function DELETE(request: NextRequest) {
  const cookieStore = cookies()
  const supabase = createRouteHandlerClient(cookieStore)

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const body = await request.json()
  const { endpoint } = body

  if (!endpoint) {
    return NextResponse.json({ error: 'Endpoint required' }, { status: 400 })
  }

  await supabase
    .from('push_subscriptions')
    .delete()
    .eq('member_id', user.id)
    .eq('endpoint', endpoint)

  return NextResponse.json({ unsubscribed: true })
}
