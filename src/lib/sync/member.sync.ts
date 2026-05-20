// Upserts a single member row from a GHL contact.
// Owns the members table only — course_memberships is handled
// separately in membership.sync.ts.

import { logger } from '@/lib/logger'
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
        email: contact.email.toLowerCase(),
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
