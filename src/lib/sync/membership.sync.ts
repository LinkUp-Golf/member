// Upserts course_memberships rows derived from GHL tags.
// Owns the course_memberships table only.

import { logger } from '@/lib/logger'
import { COURSE_TAG_MAP } from '@/lib/ghl/tags'
import type { SyncContext } from './types'

export async function syncCourseMemberships(params: {
  userId: string
  tags: string[]
  homeCourseId: string
  ctx: SyncContext
}): Promise<void> {
  const { userId, tags, homeCourseId, ctx } = params
  const log = logger.child({ requestId: ctx.requestId, userId, action: 'membership_sync' })

  const activeTags = (Object.keys(COURSE_TAG_MAP) as (keyof typeof COURSE_TAG_MAP)[])
    .filter(tag => tags.includes(tag))

  if (activeTags.length === 0) {
    log.debug('No active course tags — skipping membership sync')
    return
  }

  for (const tag of activeTags) {
    const courseSlug = COURSE_TAG_MAP[tag]

    const { data: course } = await ctx.supabase
      .from('courses')
      .select('id')
      .eq('slug', courseSlug)
      .single()

    if (!course) {
      log.warn('Course not found for tag', { metadata: { tag, courseSlug } })
      continue
    }

    const { error } = await ctx.supabase
      .from('course_memberships')
      .upsert(
        {
          member_id: userId,
          course_id: course.id,
          access_type: course.id === homeCourseId ? 'home' : 'guest',
          status: 'active',
        },
        { onConflict: 'member_id,course_id,access_type' }
      )

    if (error) {
      log.error('Course membership upsert failed', {
        errorMessage: error.message,
        metadata: { tag, courseSlug },
      })
    }
  }

  log.debug('Course memberships synced', { metadata: { activeTags } })
}
