export const dynamic = 'force-dynamic'

// GET /api/courses?search=...&city=...&state=...
// Returns every bookable course (has a GHL calendar + a payment link) —
// any member can book any of these directly, with no access-request gate.
// search/city/state filter server-side so the member "select an event"
// screen doesn't need to fetch the full list to narrow it down.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createRouteHandlerClient, createAdminClient } from '@/lib/supabase-server'

export async function GET(req: NextRequest) {
  const cookieStore = cookies()
  const supabase = createRouteHandlerClient(cookieStore)

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const admin = createAdminClient()

  const search = req.nextUrl.searchParams.get('search')?.trim()
  const city = req.nextUrl.searchParams.get('city')?.trim()
  const state = req.nextUrl.searchParams.get('state')?.trim()

  let query = admin
    .from('courses')
    .select('*')
    .eq('active', true)
    .eq('approval_status', 'active')
    .not('ghl_calendar_id', 'is', null)  // exclude courses without a GHL calendar
    .not('payment_url', 'is', null)      // exclude courses without a payment link

  if (search) query = query.ilike('name', `%${search.replace(/[%_]/g, '\\$&')}%`)
  if (city) query = query.eq('city', city)
  if (state) query = query.eq('state', state)

  const { data: courses, error } = await query.order('name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ courses: courses ?? [] })
}
