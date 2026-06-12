export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import type { AuthContext } from '@/lib/auth/types'

export interface DayPlayer {
  member_id: string
  first_name: string
  last_name: string
  avatar_url: string | null
  tee_time: string
  players: number
}

// GET /api/bookings/day?date=YYYY-MM-DD
// Returns other members (same course) who have active bookings on the given date.
export const GET = withAuth(
  async (req: NextRequest, ctx: AuthContext) => {
    const date = req.nextUrl.searchParams.get('date')
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'date param required (YYYY-MM-DD)' }, { status: 400 })
    }

    const admin = createAdminClient()

    const { data: member } = await admin
      .from('members')
      .select('home_course_id')
      .eq('id', ctx.userId)
      .single()

    if (!member) return NextResponse.json({ players: [] })

    const { data: bookings } = await admin
      .from('bookings')
      .select('member_id, tee_time, players, members!inner(id, first_name, last_name, profile:member_profiles(avatar_url))')
      .eq('course_id', member.home_course_id)
      .eq('booking_date', date)
      .is('guest_name', null)
      .in('status', ['availability_confirmed', 'payment_confirmed', 'confirmed'])
      .neq('member_id', ctx.userId)

    const players: DayPlayer[] = (bookings ?? []).map((b) => {
      const m = b.members as unknown as {
        id: string
        first_name: string
        last_name: string
        profile: { avatar_url: string | null } | { avatar_url: string | null }[] | null
      }
      const profile = Array.isArray(m.profile) ? m.profile[0] : m.profile
      return {
        member_id: m.id,
        first_name: m.first_name,
        last_name: m.last_name,
        avatar_url: profile?.avatar_url ?? null,
        tee_time: b.tee_time,
        players: b.players,
      }
    })

    return NextResponse.json({ players })
  },
  { skipGHLCheck: true }
)
