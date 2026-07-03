export const dynamic = 'force-dynamic'

// GET /api/courses
// Returns every bookable course (has a GHL calendar + a payment link) —
// any member can book any of these directly, with no access-request gate.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createRouteHandlerClient, createAdminClient } from '@/lib/supabase-server'

export async function GET(_req: NextRequest) {
  const cookieStore = cookies()
  const supabase = createRouteHandlerClient(cookieStore)

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const admin = createAdminClient()

  const { data: courses, error } = await admin
    .from('courses')
    .select('*')
    .eq('active', true)
    .eq('approval_status', 'active')
    .not('ghl_calendar_id', 'is', null)  // exclude courses without a GHL calendar
    .not('payment_url', 'is', null)      // exclude courses without a payment link
    .order('name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ courses: courses ?? [] })
}
