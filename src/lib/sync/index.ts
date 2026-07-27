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
import { COURSE_TAG_MAP, hasAnyAccessTag, hasCourseAccessTag, hasHostTag, hasPartnerTag } from '@/lib/ghl/tags'
import { getContactByIdStrict } from '@/lib/ghl/client'
import { upsertMember, deactivateMember, stampMembershipLifecycle } from './member.sync'
import { syncCourseMemberships } from './membership.sync'
import { ensureHostRow, ensurePartnerRow } from './roles.sync'
import { prefillProfileFromGhl } from './profile.sync'
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

  // A golf member carries a course tag; a role-only user (referral partner /
  // host with no membership) does not, and becomes a course-less non-member.
  const isMember = hasCourseAccessTag(tags)
  let homeCourseId: string | null = null

  const homeTag = (Object.keys(COURSE_TAG_MAP) as (keyof typeof COURSE_TAG_MAP)[])
    .find(tag => tags.includes(tag))

  if (isMember && homeTag) {
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
    homeCourseId = homeCourse.id
  }

  // Upsert member row (course-less for a non-member)
  const memberResult = await upsertMember({ contact, userId, homeCourseId, isMember, ctx })
  if (!memberResult.success) return memberResult

  // Prefill business_name / role_title / linkedin_url from GHL custom fields
  // (fill-if-blank; never clobbers the member's own edits).
  await prefillProfileFromGhl({ userId, contact, ctx })

  // Course memberships only apply to golf members.
  if (isMember && homeCourseId) {
    await syncCourseMemberships({ userId, tags, homeCourseId, ctx })
  }

  // Provision the workspace row each role tag implies (idempotent).
  if (hasHostTag(tags)) await ensureHostRow(userId, contact, ctx)
  if (hasPartnerTag(tags)) await ensurePartnerRow(userId, contact, ctx)

  log.info('Member sync complete', { ghlContactId: contact.id, metadata: { isMember } })
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
// Uses getContactByIdStrict so a genuine 404 (contact deleted in GHL) is told
// apart from a transient outage:
//   - contact present, access tag  → full sync (tags + active)
//   - contact present, no access tag → deactivate + refresh stored tags
//   - contact deleted (404)        → deactivate + clear tags (no longer a member)
//   - outage / network (throws)    → leave tags as-is, count as failed
// The failed/refreshed split lets the payment flow fail closed on a total
// outage instead of paying on stale membership tags.

export async function refreshMembersFromGhl(
  members: Array<{ id: string; ghl_contact_id: string | null }>,
  ctx: SyncContext
): Promise<{ refreshed: number; failed: number }> {
  let refreshed = 0
  let failed = 0

  async function storeTags(memberId: string, tags: string[]) {
    await deactivateMember(memberId, ctx)
    await ctx.supabase
      .from('members')
      .update({ ghl_tags: tags, updated_at: new Date().toISOString() })
      .eq('id', memberId)
    // Lost their membership tag — stamp the cancellation so commission accrual stops.
    await stampMembershipLifecycle(ctx.supabase, memberId, tags)
  }

  for (const m of members) {
    if (!m.ghl_contact_id) { failed++; continue }
    try {
      const contact = await getContactByIdStrict(m.ghl_contact_id)

      if (!contact) {
        // Genuinely deleted in GHL — no longer a member; clear the stale tags
        // so they stop counting as converted.
        await storeTags(m.id, [])
        refreshed++
        continue
      }

      const tags = contact.tags ?? []
      if (hasAnyAccessTag(tags)) {
        const result = await syncMember({ contact, userId: m.id, ctx })
        if (!result.success) { failed++; continue }
      } else {
        await storeTags(m.id, tags)
      }
      refreshed++
    } catch {
      // Outage / transient — do NOT touch the stored tags; this counts as a
      // failure so a whole-outage payout is refused rather than run stale.
      failed++
    }
  }

  return { refreshed, failed }
}
