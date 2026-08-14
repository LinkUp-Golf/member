export const dynamic = 'force-dynamic'

// POST /api/courses/request — a member proposes a golf club that isn't yet on
// LinkUp. The club is created as a `pending` course (see requestPendingCourse)
// and lands in the admin golf-events "Pending" queue for an admin to set up and
// approve into a live, bookable course.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { validateProposedClub } from '@/lib/validation'
import { requestPendingCourse } from '@/lib/courses/request-course'
import { logger } from '@/lib/logger'
import type { AuthContext } from '@/lib/auth/types'

export const POST = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  const body = (await req.json().catch(() => ({}))) as { name?: string; website?: string }

  // Shared with the hosted-event new-club path so the same club proposed from
  // either place is held to the same rule. The website stays optional here: this
  // endpoint also backs the host application, which a human reviews.
  const { valid, errors } = validateProposedClub(body)
  if (!valid) return NextResponse.json({ error: errors[0] }, { status: 400 })

  const website = typeof body.website === 'string' && body.website.trim() ? body.website.trim() : null

  const admin = createAdminClient()
  const result = await requestPendingCourse({
    admin,
    name: (body.name ?? '').trim(),
    website,
    requestedBy: ctx.memberId,
  })

  if (result.error || !result.course) {
    return NextResponse.json({ error: result.error ?? 'Could not add the club.' }, { status: result.status ?? 500 })
  }

  logger.info('Course requested by member', {
    action: 'course.requested',
    userId: ctx.userId,
    metadata: { course_id: result.course.id, reused: !!result.alreadyRequested },
  })

  return NextResponse.json(
    { course: result.course, alreadyRequested: !!result.alreadyRequested },
    { status: result.alreadyRequested ? 200 : 201 },
  )
})
