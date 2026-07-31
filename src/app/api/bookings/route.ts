export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient, createRouteHandlerClient } from '@/lib/supabase-server'
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
    .or(`member_id.eq.${ctx.userId},player_member_id.eq.${ctx.userId}`)
    .order('booking_date', { ascending: true })

  if (upcoming) {
    query = query
      .in('status', ['tentative', 'availability_confirmed', 'payment_confirmed', 'confirmed'])
      .gte('booking_date', new Date().toISOString().slice(0, 10))
  }

  if (limit > 0) query = query.limit(limit)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let rows = data ?? []

  // For rows where the user is an invited player, fetch the full sibling group
  // (all other booking rows for that same slot) so the card can show all players.
  // These sibling rows are marked is_sibling=true — view-only for the invited member.
  const invitedRows = rows.filter(b => b.player_member_id === ctx.userId)
  if (invitedRows.length > 0) {
    const admin = createAdminClient()

    // Attach booker first name
    const bookerIds = [...new Set(invitedRows.map(b => b.member_id))]
    const { data: bookers } = await supabase
      .from('members')
      .select('id, first_name')
      .in('id', bookerIds)
    const nameById = Object.fromEntries((bookers ?? []).map(m => [m.id as string, m.first_name as string]))

    rows = rows.map(b =>
      b.player_member_id === ctx.userId
        ? { ...b, booker_name: nameById[b.member_id] ?? null }
        : b
    )

    // Fetch all sibling rows for each invited slot
    const existingIds = new Set(rows.map(b => b.id as string))
    const siblingRows: typeof rows = []

    await Promise.all(invitedRows.map(async inv => {
      const { data: siblings } = await admin
        .from('bookings')
        .select('*')
        .eq('member_id', inv.member_id)   // same booker
        .eq('booking_date', inv.booking_date)
        .eq('tee_time', inv.tee_time)
        .eq('created_at', inv.created_at) // same transaction — not just a coincidental same-slot booking
        .neq('id', inv.id)                // exclude the invited member's own row

      for (const s of siblings ?? []) {
        if (!existingIds.has(s.id as string)) {
          existingIds.add(s.id as string)
          siblingRows.push({ ...s, is_sibling: true, booker_name: nameById[inv.member_id] ?? null })
        }
      }
    }))

    rows = [...rows, ...siblingRows]
  }

  // Resolve each booking's course via the admin client. The courses RLS policy
  // only exposes courses a member *belongs to*, so an embedded join returns null
  // for guest/away bookings at courses the member isn't a member of. Since these
  // are the member's own bookings, they're authorized to see the course name.
  rows = await attachCourses(rows)

  return NextResponse.json(rows)
})

// Batch-fetch the courses referenced by these bookings (admin client, bypasses
// the belongs-to-only courses RLS) and attach the same limited fields the UI
// uses onto each row as `course`.
async function attachCourses(rows: Array<Record<string, unknown>>) {
  const courseIds = [...new Set(rows.map(r => r.course_id as string).filter(Boolean))]
  if (courseIds.length === 0) return rows

  const admin = createAdminClient()
  const { data: courses } = await admin
    .from('courses')
    // meeting_duration_mins lets the client work out when a round finished —
    // My Bookings uses it to decide when to offer "Rate round".
    .select('id, name, city, state, payment_url, timezone, meeting_duration_mins')
    .in('id', courseIds)

  const byId = new Map((courses ?? []).map(c => [c.id as string, c]))
  return rows.map(r => {
    const c = byId.get(r.course_id as string)
    return {
      ...r,
      course: c
        ? {
            name: c.name,
            city: c.city,
            state: c.state,
            payment_url: c.payment_url ?? null,
            timezone: c.timezone,
            meeting_duration_mins: c.meeting_duration_mins ?? null,
          }
        : null,
    }
  })
}
