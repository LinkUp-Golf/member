export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
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

// Returns the Aviara date ("YYYY-MM-DD") and time ("HH:MM:SS") for a given UTC timestamp.
function aviaraParts(utcMs: number): { date: string; time: string } {
  const d = new Date(utcMs)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: AVIARA_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}:${get('second')}`,
  }
}

// Returns the UTC offset in milliseconds for the given IANA timezone on the given date string.
function tzOffsetMs(tz: string, dateStr: string): number {
  // Use noon UTC of the date as a stable DST-safe reference point.
  const ref = new Date(`${dateStr}T12:00:00Z`)
  const raw = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'shortOffset',
  }).formatToParts(ref).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+0'
  const m = raw.match(/GMT([+-])(\d+)(?::(\d+))?/)
  const sign = m?.[1] === '-' ? -1 : 1
  const h = parseInt(m?.[2] ?? '0', 10)
  const min = parseInt(m?.[3] ?? '0', 10)
  return sign * (h * 60 + min) * 60_000
}

// GET /api/bookings/day?date=YYYY-MM-DD&timezone=IANA_TZ
// Returns members (same home course) who have confirmed bookings on the given LOCAL date.
// The timezone param converts the user's local day to the correct Aviara date range.
export const GET = withAuth(
  async (req: NextRequest, ctx: AuthContext) => {
    const date = req.nextUrl.searchParams.get('date')
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'date param required (YYYY-MM-DD)' }, { status: 400 })
    }

    const clientTz = req.nextUrl.searchParams.get('timezone') ?? AVIARA_TIMEZONE
    let timezone = AVIARA_TIMEZONE
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: clientTz })
      timezone = clientTz
    } catch {
      // invalid timezone string — fall back to Aviara
    }

    // Convert user's local day (00:00 – 23:59) to UTC using their offset.
    const offsetMs = tzOffsetMs(timezone, date)
    const dayStartUtc = new Date(`${date}T00:00:00Z`).getTime() - offsetMs
    const dayEndUtc = new Date(`${date}T23:59:59Z`).getTime() - offsetMs

    // Map those UTC boundaries to Aviara date + time.
    const avStart = aviaraParts(dayStartUtc)
    const avEnd = aviaraParts(dayEndUtc)

    const admin = createAdminClient()

    const { data: member } = await admin
      .from('members')
      .select('home_course_id')
      .eq('id', ctx.userId)
      .single()

    if (!member) return NextResponse.json({ players: [] })

    // Base query — apply course / status / guest filters.
    let bookingsQuery = admin
      .from('bookings')
      .select('member_id, booking_date, tee_time, players')
      .eq('course_id', member.home_course_id)
      .is('guest_name', null)
      .in('status', ['availability_confirmed', 'payment_confirmed', 'confirmed'])

    if (avStart.date === avEnd.date) {
      // User's local day falls entirely within one Aviara calendar date.
      bookingsQuery = bookingsQuery
        .eq('booking_date', avStart.date)
        .gte('tee_time', avStart.time)
        .lte('tee_time', avEnd.time)
    } else {
      // User's local day spans two Aviara calendar dates (e.g. UTC+8 users).
      bookingsQuery = bookingsQuery.or(
        `and(booking_date.eq.${avStart.date},tee_time.gte.${avStart.time}),` +
          `and(booking_date.eq.${avEnd.date},tee_time.lte.${avEnd.time})`,
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
