import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { withAuth } from '@/lib/auth/with-auth'
import { createRouteHandlerClient } from '@/lib/supabase-server'
import { validateString, validateDate } from '@/lib/validation'
import type { AuthContext } from '@/lib/auth/types'

export const GET = withAuth(async (_req: NextRequest, ctx: AuthContext) => {
  const supabase = createRouteHandlerClient(cookies())

  const { data: member } = await supabase
    .from('members').select('home_course_id').eq('id', ctx.userId).single()

  const [coursesRes, requestsRes] = await Promise.all([
    supabase
      .from('courses')
      .select('*')
      .eq('active', true)
      .neq('id', member?.home_course_id ?? ''),

    supabase
      .from('guest_access_requests')
      .select('*')
      .eq('requesting_member_id', ctx.userId)
      .order('created_at', { ascending: false }),
  ])

  return NextResponse.json({
    courses: coursesRes.data ?? [],
    requests: requestsRes.data ?? [],
  })
})

export const POST = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  const supabase = createRouteHandlerClient(cookies())
  const body = await req.json() as Record<string, unknown>

  const errors: string[] = []
  const reasonCheck = validateString(body.reason, 'reason', { min: 10, max: 500 })
  const fromCheck = validateDate(body.visit_from, 'visit_from')
  const untilCheck = validateDate(body.visit_until, 'visit_until')

  if (!reasonCheck.valid) errors.push(...reasonCheck.errors)
  if (!fromCheck.valid) errors.push(...fromCheck.errors)
  if (!untilCheck.valid) errors.push(...untilCheck.errors)
  if (!body.target_course_id) errors.push('target_course_id is required')
  if (errors.length) return NextResponse.json({ error: errors[0] }, { status: 400 })

  const { data, error } = await supabase
    .from('guest_access_requests')
    .insert({
      requesting_member_id: ctx.userId,
      target_course_id: body.target_course_id as string,
      reason: body.reason as string,
      visit_from: body.visit_from as string,
      visit_until: body.visit_until as string,
      status: 'pending',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data, { status: 201 })
})
