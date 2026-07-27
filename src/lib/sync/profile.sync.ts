// Prefills member_profiles attributes from a GHL contact's custom fields.
// Owns only the three GHL-sourced profile columns below — the rest of the
// profile is member-editable in-app and never touched here.

import { logger } from '@/lib/logger'
import { getContactCustomFieldValues } from '@/lib/ghl/client'
import type { GHLContact } from '@/types'
import type { SyncContext } from './types'

// GHL contact custom-field object key → member_profiles column.
const PROFILE_FIELD_MAP = {
  'contact.company_name': 'business_name',
  'contact.title': 'role_title',
  'contact.linkedin': 'linkedin_url',
} as const

type ProfileColumn = (typeof PROFILE_FIELD_MAP)[keyof typeof PROFILE_FIELD_MAP]

/**
 * Prefill profile attributes from GHL custom fields WITHOUT clobbering values
 * the member has already set in-app: a column is written only when it's
 * currently blank. Best-effort — a failure here must never break login/sync.
 *
 * Runs after upsertMember, so the profile row (auto-created by the
 * on_member_created trigger) is guaranteed to exist.
 */
export async function prefillProfileFromGhl(params: {
  userId: string
  contact: GHLContact
  ctx: SyncContext
}): Promise<void> {
  const { userId, contact, ctx } = params
  const log = logger.child({ requestId: ctx.requestId, userId, action: 'profile_prefill' })

  try {
    const values = await getContactCustomFieldValues(contact, Object.keys(PROFILE_FIELD_MAP))
    if (Object.keys(values).length === 0) return

    const { data: profile, error: readErr } = await ctx.supabase
      .from('member_profiles')
      .select('business_name, role_title, linkedin_url')
      .eq('id', userId)
      .single()

    if (readErr || !profile) {
      log.warn('Profile prefill skipped — profile not readable', { errorMessage: readErr?.message })
      return
    }

    const current = profile as Record<ProfileColumn, string | null>
    const updates: Partial<Record<ProfileColumn, string>> = {}
    for (const [key, column] of Object.entries(PROFILE_FIELD_MAP) as [string, ProfileColumn][]) {
      const incoming = values[key]
      const existing = current[column]
      // Only fill blanks — never overwrite a value the member set themselves.
      if (incoming && (existing == null || existing.trim() === '')) {
        updates[column] = incoming
      }
    }

    if (Object.keys(updates).length === 0) return

    const { error: updErr } = await ctx.supabase
      .from('member_profiles')
      .update(updates)
      .eq('id', userId)

    if (updErr) {
      log.warn('Profile prefill update failed', { errorMessage: updErr.message })
      return
    }

    log.info('Profile prefilled from GHL', { metadata: { fields: Object.keys(updates) } })
  } catch (err) {
    log.warn('Profile prefill failed', { errorMessage: String(err) })
  }
}
