export const dynamic = 'force-dynamic'

// POST /api/courses/request — a member proposes a golf club that isn't yet on
// LinkUp. The club is created as a `pending` course (see requestPendingCourse)
// and lands in the admin golf-events "Pending" queue for an admin to set up and
// approve into a live, bookable course.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { validateString } from '@/lib/validation'
import { requestPendingCourse } from '@/lib/courses/request-course'
import { logger } from '@/lib/logger'
import type { AuthContext } from '@/lib/auth/types'

export const POST = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  const body = (await req.json().catch(() => ({}))) as { name?: string; website?: string }

  const { valid, errors } = validateString(body.name, 'Golf club name', { min: 2, max: 120 })
  if (!valid) return NextResponse.json({ error: errors[0] }, { status: 400 })

  // Optional club website — validate the shape if one was supplied.
  let website: string | null = null
  if (typeof body.website === 'string' && body.website.trim()) {
    const w = body.website.trim()
    if (!/^https?:\/\/.+/i.test(w)) {
      return NextResponse.json({ error: 'Website must be a valid URL (https://…).' }, { status: 400 })
    }
    website = w
  }

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
