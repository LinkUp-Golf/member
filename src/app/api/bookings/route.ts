import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { withAuth } from '@/lib/auth/with-auth'
import { createRouteHandlerClient } from '@/lib/supabase-server'
import type { AuthContext } from '@/lib/auth/types'

// GET /api/bookings
// ?upcoming=true   — only confirmed bookings from today onwards
// ?limit=n         — max results (default: all)
export const GET = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  const supabase = createRouteHandlerClient(cookies())
  const { searchParams } = req.nextUrl
  const upcoming = searchParams.get('upcoming') === 'true'
  const limit = parseInt(searchParams.get('limit') ?? '0', 10)

  let query = supabase
    .from('bookings')
    .select('*')
    .eq('member_id', ctx.userId)
    .neq('status', 'cancelled')
    .order('booking_date', { ascending: true })

  if (upcoming) {
    query = query
      .eq('status', 'confirmed')
      .gte('booking_date', new Date().toISOString().slice(0, 10))
  }

  if (limit > 0) query = query.limit(limit)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
})
