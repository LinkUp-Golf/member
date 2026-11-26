// App → GHL half of the two-way profile sync (rules: src/lib/ghl/profile-fields.ts).
//
// A member's edit is written to GHL *first*, and these functions throw on any
// failure so the caller can refuse the save. Saving locally anyway would look
// fine for a day, until the nightly GHL → app sync put GHL's old value back
// over the member's change.

import {
  addContactTagsStrict,
  getContactCustomFieldDefs,
  ghlFetch,
  removeContactTagsStrict,
} from '@/lib/ghl/client'
import { logger } from '@/lib/logger'
import {
  contactUpdateBody,
  genderTagChanges,
  type ProfileChanges,
  type StoredGender,
} from '@/lib/ghl/profile-fields'

export class GhlProfileSyncError extends Error {}

/** Writes profile fields to the GHL contact. No-op when there's nothing to write. */
export async function pushProfileToGhl(contactId: string, changes: ProfileChanges): Promise<void> {
  if (Object.keys(changes).length === 0) return

  const defs = await getContactCustomFieldDefs()
  const { body, missing } = contactUpdateBody(changes, new Map(defs.map(d => [d.fieldKey, d.id])))
  if (missing.length) {
    logger.error('GHL custom fields not found for profile sync', {
      action: 'ghl_profile_push',
      metadata: { missing, contactId },
    })
    throw new GhlProfileSyncError(`GoHighLevel has no field ${missing.join(', ')}`)
  }

  try {
    await ghlFetch(`/contacts/${contactId}`, { method: 'PUT', body: JSON.stringify(body) })
  } catch (err) {
    logger.warn('GHL profile push failed', { action: 'ghl_profile_push', errorMessage: String(err), metadata: { contactId } })
    throw new GhlProfileSyncError('Could not reach GoHighLevel')
  }
}

/** Leaves exactly one gender tag on the contact (none for null). */
export async function pushGenderToGhl(contactId: string, gender: StoredGender | null): Promise<void> {
  const { add, remove } = genderTagChanges(gender)
  try {
    await removeContactTagsStrict(contactId, remove)
    await addContactTagsStrict(contactId, add)
  } catch (err) {
    logger.warn('GHL gender tag push failed', { action: 'ghl_gender_push', errorMessage: String(err), metadata: { contactId } })
    throw new GhlProfileSyncError('Could not reach GoHighLevel')
  }
}
