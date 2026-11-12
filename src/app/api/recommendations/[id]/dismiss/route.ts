export const dynamic = 'force-dynamic'

// POST /api/recommendations/[id]/dismiss — "Not now". Hides the
// recommendation, and keeps that member off the admin's list for this member
// for DISMISS_COOLDOWN_DAYS (src/lib/matching/candidates.ts).
//
// Service role, scoped to the session's member: the table's only policy is a
// member reading their own rows.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { logActivity } from '@/lib/activity/log'
import { validateUUID } from '@/lib/validation'
import type { AuthContext } from '@/lib/auth/types'

export const POST = withAuth(async (
  _req: NextRequest,
  ctx: AuthContext,
  routeCtx?: { params: Record<string, string> },
) => {
  const id = routeCtx?.params?.['id']
  if (!id || !validateUUID(id, 'id').valid) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data, error } = await createAdminClient()
    .from('play_suggestions')
    .update({ dismissed: true, dismissed_at: new Date().toISOString() })
    .eq('id', id)
    .eq('member_id', ctx.userId)
    .select('suggested_id')
    .maybeSingle()

  if (error) return NextResponse.json({ error: 'Could not hide this recommendation.' }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  void logActivity({
    memberId: ctx.userId,
    action: 'recommendation_dismissed',
    courseId: ctx.homeCourseId,
    targetId: data.suggested_id,
  })

  return NextResponse.json({ dismissed: true })
})
