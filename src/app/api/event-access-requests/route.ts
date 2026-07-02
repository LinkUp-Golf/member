export const dynamic = 'force-dynamic'

// POST /api/event-access-requests
// A member without the GHL tag required to book a course/event asks an
// admin to grant them access. Idempotent — resubmitting while a request
// is already pending just returns the existing one.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { withAuth } from '@/lib/auth/with-auth'
import { createRouteHandlerClient } from '@/lib/supabase-server'
import type { AuthContext } from '@/lib/auth/types'

export const POST = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  const body = await req.json() as { course_id?: string }
  if (!body.course_id) return NextResponse.json({ error: 'course_id is required' }, { status: 400 })

  const supabase = createRouteHandlerClient(cookies())

  const { data: existing } = await supabase
    .from('event_access_requests')
    .select('*')
    .eq('member_id', ctx.userId)
    .eq('course_id', body.course_id)
    .eq('status', 'pending')
    .maybeSingle()

  if (existing) return NextResponse.json(existing)

  const { data, error } = await supabase
    .from('event_access_requests')
    .insert({ member_id: ctx.userId, course_id: body.course_id })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
})
