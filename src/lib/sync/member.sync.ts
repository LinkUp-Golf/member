// Upserts a single member row from a GHL contact.
// Owns the members table only — course_memberships is handled
// separately in membership.sync.ts.

import { logger } from '@/lib/logger'
import { hasMembershipTag } from '@/lib/ghl/tags'
import type { GHLContact } from '@/types'
import type { SyncContext, SyncResult } from './types'

interface UpsertMemberParams {
  contact: GHLContact
  userId: string
  homeCourseId: string
  ctx: SyncContext
}

export async function upsertMember({
  contact,
  userId,
  homeCourseId,
  ctx,
}: UpsertMemberParams): Promise<SyncResult> {
  const log = logger.child({
    requestId: ctx.requestId,
    userId,
    action: 'member_upsert',
  })

  const { error } = await ctx.supabase
    .from('members')
    .upsert(
      {
        id: userId,
        ghl_contact_id: contact.id,
        email: (contact.email ?? '').toLowerCase(),
        first_name: contact.firstName ?? '',
        last_name: contact.lastName ?? '',
        phone: contact.phone ?? null,
        home_course_id: homeCourseId,
        membership_status: 'active',
        ghl_tags: contact.tags ?? [],
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    )

  if (error) {
    log.error('Member upsert failed', { errorMessage: error.message })
    return { success: false, userId, action: 'updated', error: error.message }
  }

  // Stamp the membership start date the first time we observe a membership tag,
  // and never overwrite it. This is the date referral commission is dated and
  // rate-windowed against — without it, that logic would fall back to the
  // referral link's creation date and could credit a conversion in the wrong
  // month or after the rate term. `.is(null)` makes it set-once/idempotent.
  if (hasMembershipTag(contact.tags ?? [])) {
    const { error: startError } = await ctx.supabase
      .from('members')
      .update({ membership_start_date: new Date().toISOString().slice(0, 10) })
      .eq('id', userId)
      .is('membership_start_date', null)
    if (startError) {
      log.warn('membership_start_date stamp skipped', { errorMessage: startError.message })
    }
  }

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
