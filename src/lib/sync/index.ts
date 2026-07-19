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
import { getContactById } from '@/lib/ghl/client'
import { upsertMember, deactivateMember } from './member.sync'
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

// ---- Refresh a known set of members from GHL ----------------
// Re-pulls each member's current GHL tags so membership state is up to date.
// Mirrors the webhook: an access tag present → full sync (tags + active); no
// access tag → deactivate, and update ghl_tags so a removed membership tag
// isn't left stale (membership is read from ghl_tags). Best-effort per member.

export async function refreshMembersFromGhl(
  members: Array<{ id: string; ghl_contact_id: string | null }>,
  ctx: SyncContext
): Promise<{ refreshed: number; failed: number }> {
  let refreshed = 0
  let failed = 0

  for (const m of members) {
    if (!m.ghl_contact_id) { failed++; continue }
    try {
      const contact = await getContactById(m.ghl_contact_id)
      if (!contact) { failed++; continue }

      const tags = contact.tags ?? []
      if (hasAnyAccessTag(tags)) {
        const result = await syncMember({ contact, userId: m.id, ctx })
        if (!result.success) { failed++; continue }
      } else {
        // No access tag — deactivate and refresh the stored tags so the
        // membership check (which reads ghl_tags) reflects the removal.
        await deactivateMember(m.id, ctx)
        await ctx.supabase
          .from('members')
          .update({ ghl_tags: tags, updated_at: new Date().toISOString() })
          .eq('id', m.id)
      }
      refreshed++
    } catch {
      failed++
    }
  }

  return { refreshed, failed }
}
