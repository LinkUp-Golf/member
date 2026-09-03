// ============================================================
// Provisioning a non-member guest.
//
// A booker can add someone who isn't a LinkUp member and isn't a
// GHL contact yet. Everything that person needs in order to be on
// a round — a GHL contact carrying the access tags, and a LinkUp
// member row against it — is created here.
//
// This used to sit behind an admin "Setup" button, with the
// booking parked in 'awaiting_approval' until someone pressed it.
// Nothing in that step was a judgement call: it read the details
// the booker had already typed and created the same records every
// time. So it runs at booking time now, and the button is gone.
//
// Server-only — NEVER import this file in a Client Component.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { getContactByEmail, createContact, addTagToContact } from '@/lib/ghl/client'
import { ALL_ACCESS_TAGS } from '@/lib/ghl/tags'
import { syncMember } from '@/lib/sync'
import { logger } from '@/lib/logger'
import type { AdditionalPlayer, GHLContact } from '@/types'

export interface NonMemberGuest extends Partial<AdditionalPlayer> {
  email: string
}

/**
 * Creates (or finds) the guest's GHL contact, tags it for access, and makes
 * sure a LinkUp member exists for it.
 *
 * Returns the GHL contact id — the caller needs it to book the appointment.
 * Throws only if the contact itself can't be resolved, since without one there
 * is no appointment to make. A failure to create the member row is logged and
 * swallowed: the guest is on the round either way, and the daily GHL sync will
 * pick them up.
 */
export async function provisionNonMemberGuest(
  guest: NonMemberGuest,
  admin: SupabaseClient
): Promise<string> {
  const email = guest.email.trim()

  const existing = await getContactByEmail(email)
  const contactId =
    existing?.id ??
    (await createContact({
      firstName: guest.firstName ?? '',
      lastName: guest.lastName ?? '',
      email,
      phone: guest.mobile || null,
    }))

  // Tagged before the appointment is made, so the app recognises them and
  // GHL's membership workflows fire against a contact that already has access.
  for (const tag of ALL_ACCESS_TAGS) {
    await addTagToContact(contactId, tag)
  }

  try {
    await ensureMemberForContact({ admin, contactId, guest, email })
  } catch (err) {
    logger.error('Non-member guest — member sync failed (non-fatal)', {
      action: 'non_member_guest.sync_failed',
      errorMessage: err instanceof Error ? err.message : String(err),
    })
  }

  return contactId
}

async function ensureMemberForContact({
  admin,
  contactId,
  guest,
  email,
}: {
  admin: SupabaseClient
  contactId: string
  guest: NonMemberGuest
  email: string
}): Promise<void> {
  const { data: existingMember } = await admin
    .from('members')
    .select('id')
    .eq('email', email.toLowerCase())
    .single()

  let memberUserId = existingMember?.id as string | undefined

  if (!memberUserId) {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: {
        ghl_contact_id: contactId,
        first_name: guest.firstName,
        last_name: guest.lastName,
      },
    })

    if (createErr || !created.user) {
      // members.email is unique, and one booking can name the same new guest
      // on two rows — or two bookings can land at once. Either races past the
      // lookup above, so re-check for the member the winner created rather
      // than failing outright.
      const { data: racedMember } = await admin
        .from('members')
        .select('id')
        .eq('email', email.toLowerCase())
        .single()
      if (!racedMember?.id) throw new Error(createErr?.message ?? 'Auth user creation failed')
      memberUserId = racedMember.id
    } else {
      memberUserId = created.user.id
    }
  }

  if (!memberUserId) throw new Error('Could not resolve a member id for this guest')

  const contact: GHLContact = {
    id: contactId,
    email,
    firstName: guest.firstName ?? '',
    lastName: guest.lastName ?? '',
    phone: guest.mobile ?? '',
    tags: [...ALL_ACCESS_TAGS],
    customFields: [],
  }

  await syncMember({ contact, userId: memberUserId, ctx: { supabase: admin } })
}
