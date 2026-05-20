// ============================================================
// Sync orchestrator — single entry point for all GHL → Supabase
// sync operations. Composes member + membership sync.
//
// Used by:
//   - auth/callback (on login)
//   - webhooks/ghl (on GHL event)
//   - supabase/functions/ghl-bulk-sync (initial seed)
// ============================================================

import { logger } from '@/lib/logger'
import { COURSE_TAG_MAP, hasAnyAccessTag } from '@/lib/ghl/tags'
import { upsertMember } from './member.sync'
import { syncCourseMemberships } from './membership.sync'
import type { GHLContact } from '@/types'
import type { SyncContext, SyncResult } from './types'

export type { SyncResult, BulkSyncResult, SyncContext } from './types'

// ---- Single member sync ------------------------------------

export async function syncMember(params: {
  contact: GHLContact
  userId: string
  ctx: SyncContext
}): Promise<SyncResult> {
  const { contact, userId, ctx } = params
  const log = logger.child({ requestId: ctx.requestId, userId, action: 'sync_member' })
  const tags = contact.tags ?? []

  if (!hasAnyAccessTag(tags)) {
    log.warn('Contact has no access tag — sync skipped')
    return { success: true, userId, action: 'skipped' }
  }

  // Resolve home course from the first matching access tag
  const homeTag = (Object.keys(COURSE_TAG_MAP) as (keyof typeof COURSE_TAG_MAP)[])
    .find(tag => tags.includes(tag))

  if (!homeTag) {
    return { success: true, userId, action: 'skipped' }
  }

  const courseSlug = COURSE_TAG_MAP[homeTag]
  const { data: homeCourse } = await ctx.supabase
    .from('courses')
    .select('id')
    .eq('slug', courseSlug)
    .single()

  if (!homeCourse) {
    log.warn('Home course not found', { metadata: { courseSlug } })
    return { success: false, userId, action: 'skipped', error: `Course not found: ${courseSlug}` }
  }

  // Upsert member row
  const memberResult = await upsertMember({
    contact,
    userId,
    homeCourseId: homeCourse.id,
    ctx,
  })

  if (!memberResult.success) return memberResult

  // Upsert course memberships
  await syncCourseMemberships({
    userId,
    tags,
    homeCourseId: homeCourse.id,
    ctx,
  })

  log.info('Member sync complete', { ghlContactId: contact.id })
  return { success: true, userId, action: 'updated' }
}

// ---- Webhook-triggered sync (contact ID known, no userId yet) --
// Used when GHL fires a webhook for a contact that may or may not
// have a Supabase account yet.

export async function syncMemberByContactId(params: {
  contact: GHLContact
  ctx: SyncContext
}): Promise<SyncResult> {
  const { contact, ctx } = params

  // Look up the Supabase user by GHL contact ID
  const { data: member } = await ctx.supabase
    .from('members')
    .select('id')
    .eq('ghl_contact_id', contact.id)
    .single()

  if (!member) {
    // Contact doesn't have a Supabase account yet — they haven't logged in.
    // Nothing to sync until they authenticate for the first time.
    logger.debug('No Supabase member for GHL contact — skipping', {
      metadata: { ghlContactId: contact.id },
    })
    return { success: true, action: 'skipped' }
  }

  return syncMember({ contact, userId: member.id, ctx })
}
