import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { withAuth } from '@/lib/auth/with-auth'
import { createRouteHandlerClient } from '@/lib/supabase-server'
import type { AuthContext } from '@/lib/auth/types'

// POST /api/events/[id]/rsvp   body: { status: 'attending' | 'maybe' | 'declined' }
export const POST = withAuth(async (
  req: NextRequest,
  ctx: AuthContext,
  routeCtx?: { params: Record<string, string> }
) => {
  const supabase = createRouteHandlerClient(cookies())
  const { status } = await req.json() as { status: string }

  const valid = ['attending', 'maybe', 'declined']
  if (!valid.includes(status)) {
    return NextResponse.json({ error: 'Invalid RSVP status' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('member_event_rsvps')
    .upsert(
      { event_id: routeCtx!.params.id, member_id: ctx.userId, status },
      { onConflict: 'event_id,member_id' }
    )
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
})
