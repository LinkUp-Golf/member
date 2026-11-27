// Upserts a single member row from a GHL contact.
// Owns the members table only — course_memberships is handled
// separately in membership.sync.ts.

import { logger } from '@/lib/logger'
import { hasMembershipTag } from '@/lib/ghl/tags'
import { withoutGenderTags } from '@/lib/ghl/profile-fields'
import { becomesFormerMember, FORMER_MEMBER_STATUS } from '@/lib/auth/former-member'
import { getCache } from '@/lib/cache'
import { COURSE_MEMBERS_NS, courseMembersPrefix } from '@/lib/cache/keys'
import type { GHLContact } from '@/types'
import type { SyncContext, SyncResult } from './types'

interface UpsertMemberParams {
  contact: GHLContact
  userId: string
  /** The home course, or null for a role-only non-member. */
  homeCourseId: string | null
  /** True when the contact holds a course/membership tag; false for a role-only non-member. */
  isMember: boolean
  ctx: SyncContext
}

export async function upsertMember({
  contact,
  userId,
  homeCourseId,
  isMember,
  ctx,
}: UpsertMemberParams): Promise<SyncResult> {
  const log = logger.child({
    requestId: ctx.requestId,
    userId,
    action: 'member_upsert',
  })

  // Identity fields are always refreshed from GHL (the source of truth).
  const base = {
    id: userId,
    ghl_contact_id: contact.id,
    email: (contact.email ?? '').toLowerCase(),
    first_name: contact.firstName ?? '',
    last_name: contact.lastName ?? '',
    phone: contact.phone ?? null,
    // Without the gender-* tags: this copy reaches other members' devices in
    // places, and gender is private (it's kept in member_match_profiles by
    // syncProfileFromGhl instead).
    ghl_tags: withoutGenderTags(contact.tags ?? []),
    updated_at: new Date().toISOString(),
  }

  // What the row said before this sync: whether they were ever a member, and
  // which directory they were listed in.
  const { data: prior } = await ctx.supabase
    .from('members')
    .select('membership_status, membership_start_date, home_course_id')
    .eq('id', userId)
    .maybeSingle()

  // Membership fields track GHL (the source of truth):
  //  - has a course tag  → golf member: set the home course, mark active
  //  - lost every access and role tag after being a member → former member
  //    (@/lib/auth/former-member): keep the home course, so the rounds they
  //    still have stay theirs to see, but drop out of every active-members
  //    list. An admin's 'suspended' is left as it is.
  //  - otherwise (a role tag, or never a member) → 'non_member', no home
  //    course. This runs only after GHL answered with the contact, so an
  //    empty tag set genuinely means "not a member", not a transient blip.
  const row = isMember
    ? { ...base, home_course_id: homeCourseId, membership_status: 'active' }
    : becomesFormerMember(contact.tags ?? [], prior)
      ? {
          ...base,
          home_course_id: prior?.home_course_id ?? null,
          membership_status: prior?.membership_status === 'suspended' ? 'suspended' : FORMER_MEMBER_STATUS,
        }
      : { ...base, home_course_id: null, membership_status: 'non_member' }

  const { error } = await ctx.supabase
    .from('members')
    .upsert(row, { onConflict: 'id' })

  if (error) {
    log.error('Member upsert failed', { errorMessage: error.message })
    return { success: false, userId, action: 'updated', error: error.message }
  }

  // The member directory is cached per course for 15 minutes. A member
  // joining or leaving it shouldn't wait that out.
  if (prior?.membership_status !== row.membership_status || prior?.home_course_id !== row.home_course_id) {
    const cache = getCache(COURSE_MEMBERS_NS)
    for (const courseId of new Set([prior?.home_course_id, row.home_course_id])) {
      if (courseId) await cache.clear(courseMembersPrefix(courseId)).catch(() => {})
    }
  }

  await stampMembershipLifecycle(ctx.supabase, userId, contact.tags ?? [])

  // Attach any referral of this person that was recorded before they had a
  // member row (a partner referred them as a non-member, by email). Populating
  // member_id lets referral reporting show them as a member and lets the
  // member-level "referred once" constraint apply. Conversion/commission is
  // matched by email regardless, so this is best-effort — a failure here must
  // not break login/sync.
  const email = (contact.email ?? '').toLowerCase()
  if (email) {
    const { error: linkError } = await ctx.supabase
      .from('referral_partner_links')
      .update({ member_id: userId, updated_at: new Date().toISOString() })
      .eq('email', email)
      .is('member_id', null)
    if (linkError) {
      log.warn('Referral link backfill skipped', { errorMessage: linkError.message })
    }
  }

  log.debug('Member upserted', { ghlContactId: contact.id })
  return { success: true, userId, action: 'updated' }
}

/**
 * Keep the membership lifecycle dates in step with GHL, which drives recurring
 * referral commission:
 *   - has a membership tag → stamp membership_start_date once, clear any
 *     cancellation (they're active again),
 *   - no membership tag but was once a member → stamp membership_ended_at once
 *     (the cancellation month accrual stops at).
 * Set-once on each date so a re-sync can't shift an established start/end.
 */
export async function stampMembershipLifecycle(
  supabase: SyncContext['supabase'],
  userId: string,
  tags: string[]
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10)
  if (hasMembershipTag(tags)) {
    await supabase.from('members')
      .update({ membership_start_date: today })
      .eq('id', userId).is('membership_start_date', null)
    await supabase.from('members')
      .update({ membership_ended_at: null })
      .eq('id', userId).not('membership_ended_at', 'is', null)
  } else {
    await supabase.from('members')
      .update({ membership_ended_at: today })
      .eq('id', userId)
      .not('membership_start_date', 'is', null)
      .is('membership_ended_at', null)
  }
}

export async function deactivateMember(
  userId: string,
  ctx: SyncContext
): Promise<SyncResult> {
  const log = logger.child({ requestId: ctx.requestId, userId, action: 'member_deactivate' })

  const { error } = await ctx.supabase
    .from('members')
    .update({ membership_status: 'suspended', updated_at: new Date().toISOString() })
    .eq('id', userId)

  if (error) {
    log.error('Member deactivation failed', { errorMessage: error.message })
    return { success: false, userId, action: 'deactivated', error: error.message }
  }

  log.info('Member deactivated — GHL tag removed')
  return { success: true, userId, action: 'deactivated' }
}
