export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { formatInTimeZone, getTimezoneOffset } from 'date-fns-tz'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { AVIARA_TIMEZONE } from '@/lib/constants'
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

// Returns the course-local date ("YYYY-MM-DD") and time ("HH:MM:SS") for a
// given UTC timestamp, in the given course's own timezone.
function courseParts(utcMs: number, timezone: string): { date: string; time: string } {
  const d = new Date(utcMs)
  return {
    date: formatInTimeZone(d, timezone, 'yyyy-MM-dd'),
    time: formatInTimeZone(d, timezone, 'HH:mm:ss'),
  }
}

// GET /api/bookings/day?date=YYYY-MM-DD&timezone=IANA_TZ
// Returns members (same home course) who have confirmed bookings on the given LOCAL date.
// The timezone param converts the user's local day to the correct date range
// in the member's home course's own timezone (not necessarily Aviara).
export const GET = withAuth(
  async (req: NextRequest, ctx: AuthContext) => {
    const date = req.nextUrl.searchParams.get('date')
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'date param required (YYYY-MM-DD)' }, { status: 400 })
    }

    const admin = createAdminClient()

    const { data: member } = await admin
      .from('members')
      .select('home_course_id, home_course:courses!members_home_course_id_fkey(timezone)')
      .eq('id', ctx.userId)
      .single()

    if (!member) return NextResponse.json({ players: [] })

    const homeCourseTimezone = (member.home_course as unknown as { timezone: string } | null)?.timezone ?? AVIARA_TIMEZONE

    const clientTz = req.nextUrl.searchParams.get('timezone') ?? homeCourseTimezone
    let timezone = homeCourseTimezone
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: clientTz })
      timezone = clientTz
    } catch {
      // invalid timezone string — fall back to the home course's own timezone
    }

    // Convert user's local day (00:00 – 23:59) to UTC using their offset.
    // Noon UTC of the date is used as a stable DST-safe reference point.
    const offsetMs = getTimezoneOffset(timezone, new Date(`${date}T12:00:00Z`))
    const dayStartUtc = new Date(`${date}T00:00:00Z`).getTime() - offsetMs
    const dayEndUtc = new Date(`${date}T23:59:59Z`).getTime() - offsetMs

    // Map those UTC boundaries to the home course's own date + time.
    const courseStart = courseParts(dayStartUtc, homeCourseTimezone)
    const courseEnd = courseParts(dayEndUtc, homeCourseTimezone)

    // Base query — apply course / status / guest filters.
    let bookingsQuery = admin
      .from('bookings')
      .select('member_id, booking_date, tee_time, players')
      .eq('course_id', member.home_course_id)
      .is('guest_name', null)
      .in('status', ['availability_confirmed', 'payment_confirmed', 'confirmed'])

    if (courseStart.date === courseEnd.date) {
      // User's local day falls entirely within one home-course calendar date.
      bookingsQuery = bookingsQuery
        .eq('booking_date', courseStart.date)
        .gte('tee_time', courseStart.time)
        .lte('tee_time', courseEnd.time)
    } else {
      // User's local day spans two home-course calendar dates (e.g. UTC+8 users).
      bookingsQuery = bookingsQuery.or(
        `and(booking_date.eq.${courseStart.date},tee_time.gte.${courseStart.time}),` +
          `and(booking_date.eq.${courseEnd.date},tee_time.lte.${courseEnd.time})`,
      )
    }

    const { data: bookings } = await bookingsQuery

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
