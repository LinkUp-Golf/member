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
  booking_date: string
  tee_time: string
  players: number
  is_self: boolean
}

// GET /api/bookings/day?date=YYYY-MM-DD
// Returns members (home course) who have confirmed bookings on the given
// date. "date" is always the course's own local calendar date — booking_date
// is stored as a literal course-local date already, so no timezone
// conversion is needed here.
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
      .select('member_id, booking_date, tee_time, players')
      .eq('course_id', member.home_course_id)
      .eq('booking_date', date)
      .is('guest_name', null)
      .in('status', ['availability_confirmed', 'payment_confirmed', 'confirmed'])

    if (!bookings?.length) return NextResponse.json({ players: [] })

    // Fetch member details separately to avoid join failures.
    const memberIds = [...new Set(bookings.map((b) => b.member_id as string))]
    const { data: members } = await admin
      .from('members')
      .select('id, first_name, last_name, profile:member_profiles(avatar_url)')
      .in('id', memberIds)

    const memberMap = Object.fromEntries(
      (members ?? []).map((m) => {
        const profile = Array.isArray(m.profile) ? m.profile[0] : m.profile
        return [
          m.id,
          {
            id: m.id as string,
            first_name: m.first_name as string,
            last_name: m.last_name as string,
            avatar_url: (profile as { avatar_url: string | null } | null)?.avatar_url ?? null,
          },
        ]
      }),
    )

    const players: DayPlayer[] = bookings
      .map((b) => {
        const m = memberMap[b.member_id as string]
        if (!m) return null
        return {
          member_id: m.id,
          first_name: m.first_name,
          last_name: m.last_name,
          avatar_url: m.avatar_url,
          booking_date: b.booking_date as string,
          tee_time: b.tee_time as string,
          players: b.players as number,
          is_self: m.id === ctx.userId,
        }
      })
      .filter((p): p is DayPlayer => p !== null)

    return NextResponse.json({ players })
  },
  { skipGHLCheck: true },
)
