// Syncs member_profiles attributes from a GHL contact's custom fields.
// Owns only the GHL-sourced profile columns below — the rest of the profile is
// member-editable in-app and never touched here.

import { logger } from '@/lib/logger'
import { getContactCustomFieldValues, getContactCustomFieldValueById } from '@/lib/ghl/client'
import { getCache } from '@/lib/cache'
import { MEMBER_DETAIL_NS, memberDetailKey } from '@/lib/cache/keys'
import { GHL_CONTACT_FIELDS } from '@/lib/constants'
import { parseNonprofits, MAX_NONPROFITS } from '@/lib/profile/nonprofits'
import type { GHLContact } from '@/types'
import type { SyncContext } from './types'

// GHL contact custom-field object key → member_profiles column.
//
// To sync another attribute, add its GHL field key here — that's the whole
// change. The key is the contact custom field's `fieldKey` in GHL
// (GET /locations/:id/customFields?model=contact); an unrecognised key is
// skipped silently by getContactCustomFieldValues, so a typo reads as "GHL
// never has a value for this" rather than as an error.
const PROFILE_FIELD_MAP = {
  'contact.company_name': 'business_name',
  'contact.title': 'role_title',
  'contact.linkedin': 'linkedin_url',
} as const

type ProfileColumn = (typeof PROFILE_FIELD_MAP)[keyof typeof PROFILE_FIELD_MAP]

// Not in PROFILE_FIELD_MAP because it isn't a straight string copy: GHL holds
// it as one per-line string and the column is a text[], so it needs parsing.
const NONPROFITS_FIELD_KEY = 'contact.nonprofits'

/**
 * Pull profile attributes from GHL custom fields, with GHL winning.
 *
 * Where GHL has a value it is written, replacing whatever is stored — GHL is
 * the source of truth for these columns, so a correction made there has to
 * reach the app rather than being blocked by whatever landed first. (This used
 * to fill blanks only, which meant an out-of-date value could never be fixed
 * from GHL.)
 *
 * Where GHL has NO value, the stored value is left alone. That isn't a
 * softening of the rule so much as the limit of what the source can say:
 * getContactCustomFieldValues returns only non-empty values, so "GHL has
 * nothing here" and "GHL says this is empty" arrive identically. Treating both
 * as "clear it" would wipe a member's own business_name / role_title /
 * linkedin_url — all three are editable in-app — every time a contact had no
 * value in GHL. Deleting real data on an ambiguous signal isn't a sync.
 *
 * Best-effort — a failure here must never break login/sync.
 *
 * Runs after upsertMember, so the profile row (auto-created by the
 * on_member_created trigger) is guaranteed to exist.
 */
export async function syncProfileFromGhl(params: {
  userId: string
  contact: GHLContact
  ctx: SyncContext
}): Promise<void> {
  const { userId, contact, ctx } = params
  const log = logger.child({ requestId: ctx.requestId, userId, action: 'profile_sync' })

  try {
    const values = await getContactCustomFieldValues(contact, [
      ...Object.keys(PROFILE_FIELD_MAP),
      NONPROFITS_FIELD_KEY,
    ])

    // By object key first (self-documenting, and the lookup is already paid
    // for above), falling back to the field id — the key can be renamed in
    // GHL and the id can't, so this survives that rename.
    const rawNonprofits =
      values[NONPROFITS_FIELD_KEY] || getContactCustomFieldValueById(contact, GHL_CONTACT_FIELDS.NONPROFITS)

    if (Object.keys(values).length === 0 && !rawNonprofits) return

    const { data: profile, error: readErr } = await ctx.supabase
      .from('member_profiles')
      .select('business_name, role_title, linkedin_url, nonprofits')
      .eq('id', userId)
      .single()

    if (readErr || !profile) {
      log.warn('Profile sync skipped — profile not readable', { errorMessage: readErr?.message })
      return
    }

    const current = profile as Record<ProfileColumn, string | null> & { nonprofits: string[] | null }
    const updates: Partial<Record<ProfileColumn, string>> & { nonprofits?: string[] } = {}
    for (const [key, column] of Object.entries(PROFILE_FIELD_MAP) as [string, ProfileColumn][]) {
      const incoming = values[key]
      // Compare before writing: re-syncs are frequent (every login, every
      // webhook, nightly), and an unchanged value shouldn't move updated_at or
      // evict the member's cache entry.
      if (incoming && incoming !== (current[column] ?? '')) {
        updates[column] = incoming
      }
    }

    // Same GHL-wins rule as the string columns above, and the same reason for
    // the `if (rawNonprofits)` guard: an empty value from GHL is
    // indistinguishable from GHL having no value, so it must not clear a list
    // the member entered in-app.
    //
    // Truncated rather than rejected, unlike the profile form. A GHL contact
    // carrying four is a value we don't control and can't ask about, and
    // dropping the sync entirely over it would also block the member's name
    // and title from updating.
    if (rawNonprofits) {
      const parsed = parseNonprofits(rawNonprofits)
      if (parsed.length > MAX_NONPROFITS) {
        log.warn('GHL contact lists more non-profits than allowed — keeping the first few', {
          metadata: { found: parsed.length, kept: MAX_NONPROFITS },
        })
      }
      const next = parsed.slice(0, MAX_NONPROFITS)
      const stored = current.nonprofits ?? []
      if (next.length && (next.length !== stored.length || next.some((v, i) => v !== stored[i]))) {
        updates.nonprofits = next
      }
    }

    if (Object.keys(updates).length === 0) return

    const { error: updErr } = await ctx.supabase
      .from('member_profiles')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', userId)

    if (updErr) {
      log.warn('Profile sync update failed', { errorMessage: updErr.message })
      return
    }

    // Other members read this profile through a 30-minute cache. Overwriting is
    // new — previously only blanks were filled, so nothing visible ever changed
    // here — and without this the old value stays on screen for half an hour.
    await getCache(MEMBER_DETAIL_NS).delete(memberDetailKey(userId)).catch(() => {})

    log.info('Profile synced from GHL', { metadata: { fields: Object.keys(updates) } })
  } catch (err) {
    log.warn('Profile sync failed', { errorMessage: String(err) })
  }
}
