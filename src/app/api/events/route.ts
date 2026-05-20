import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { withAuth } from '@/lib/auth/with-auth'
import { createRouteHandlerClient } from '@/lib/supabase-server'
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
      .select('*')
      .eq('course_id', member.home_course_id)
      .eq('status', 'published')
      .gte('event_date', today())
      .order('event_date', { ascending: true }),

    supabase
      .from('member_event_rsvps')
      .select('event_id, status')
      .eq('member_id', ctx.userId),
  ])

  return NextResponse.json({
    events: eventsRes.data ?? [],
    rsvps: rsvpRes.data ?? [],
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
