export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { withAuth } from '@/lib/auth/with-auth'
import { createRouteHandlerClient, createAdminClient } from '@/lib/supabase-server'
import { validateString, validateDate } from '@/lib/validation'
import type { AuthContext } from '@/lib/auth/types'

const today = () => new Date().toISOString().slice(0, 10)

export const GET = withAuth(async (_req: NextRequest, ctx: AuthContext) => {
  const supabase = createRouteHandlerClient(cookies())

  const { data: member } = await supabase
    .from('members').select('home_course_id').eq('id', ctx.userId).single()

  if (!member?.home_course_id) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  const [eventsRes, rsvpRes] = await Promise.all([
    supabase
      .from('member_events')
      .select('*, organizer:members!organizer_id(first_name, last_name)')
      .eq('course_id', member.home_course_id)
      .in('status', ['published', 'pending_review'])
      .gte('event_date', today())
      .order('event_date', { ascending: true }),

    supabase
      .from('member_event_rsvps')
      .select('event_id, status')
      .eq('member_id', ctx.userId),
  ])

  const events = eventsRes.data ?? []
  const eventIds = events.map(e => e.id)

  // Fetch who's attending each event — use admin client to bypass RLS,
  // which blocks the organizer from seeing other members' RSVPs via the
  // EXISTS policy when the organizer isn't in course_memberships as active.
  const attendeesMap: Record<string, { member_id: string; first_name: string; last_name: string; avatar_url: string | null }[]> = {}
  if (eventIds.length > 0) {
    const { data: rsvpRows } = await createAdminClient()
      .from('member_event_rsvps')
      .select('event_id, member_id, member:members!member_id(first_name, last_name, profile:member_profiles(avatar_url))')
      .in('event_id', eventIds)
      .eq('status', 'attending')

    for (const row of rsvpRows ?? []) {
      const m = row.member as unknown as { first_name: string; last_name: string; profile: { avatar_url: string | null } | null } | null
      if (!m) continue
      const bucket = attendeesMap[row.event_id] ?? []
      bucket.push({
        member_id: row.member_id,
        first_name: m.first_name,
        last_name: m.last_name,
        avatar_url: m.profile?.avatar_url ?? null,
      })
      attendeesMap[row.event_id] = bucket
    }
  }

  return NextResponse.json({
    events,
    rsvps: rsvpRes.data ?? [],
    attendees: attendeesMap,
  })
})

export const POST = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  const supabase = createRouteHandlerClient(cookies())
  const body = await req.json() as Record<string, unknown>

  const errors: string[] = []
  const titleCheck = validateString(body.title, 'title', { min: 3, max: 100 })
  const descCheck = validateString(body.description, 'description', { min: 10, max: 2000 })
  const dateCheck = validateDate(body.event_date, 'event_date')
  const timeCheck = validateString(body.event_time, 'event_time', { min: 4, max: 8 })
  const locCheck = validateString(body.location, 'location', { min: 2, max: 200 })

  if (!titleCheck.valid) errors.push(...titleCheck.errors)
  if (!descCheck.valid) errors.push(...descCheck.errors)
  if (!dateCheck.valid) errors.push(...dateCheck.errors)
  if (!timeCheck.valid) errors.push(...timeCheck.errors)
  if (!locCheck.valid) errors.push(...locCheck.errors)
  if (errors.length) return NextResponse.json({ error: errors[0] }, { status: 400 })

  const { data: member } = await supabase
    .from('members').select('home_course_id').eq('id', ctx.userId).single()

  const { data, error } = await supabase
    .from('member_events')
    .insert({
      course_id: member?.home_course_id,
      organizer_id: ctx.userId,
      title: body.title as string,
      description: body.description as string,
      event_date: body.event_date as string,
      event_end_date: body.event_end_date as string | null ?? null,
      event_time: body.event_time as string,
      location: body.location as string,
      external_url: body.external_url as string | null ?? null,
      status: 'pending_review',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data, { status: 201 })
})
