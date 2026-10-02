// ============================================================
// Provisioning a non-member guest.
//
// A booker can add someone who isn't a LinkUp member and isn't a
// GHL contact yet. Everything that person needs in order to be on
// a round — a GHL contact carrying the access tags plus the
// member-guest tag that says how they arrived, and a LinkUp member
// row against it — is created here.
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
import { ALL_ACCESS_TAGS, MEMBER_GUEST_TAG } from '@/lib/ghl/tags'
import { syncMember } from '@/lib/sync'
import { logger } from '@/lib/logger'
import type { AdditionalPlayer, GHLContact } from '@/types'

export interface NonMemberGuest extends Partial<AdditionalPlayer> {
  email: string
}

/** What the caller gets back: enough to book the appointment, and enough to
 *  hand the round to the person it's for. */
export interface ProvisionedGuest {
  /** GHL contact id — the appointment is made against this. */
  contactId: string
  /**
   * The LinkUp member this guest now is, or null when the member row couldn't
   * be made.
   *
   * The caller writes it onto the booking row as player_member_id, which is
   * what makes the round theirs rather than a line of text on somebody else's
   * booking: it's the only link /api/bookings reads to show a member a round
   * they didn't book. Null is survivable — the guest is on the round either
   * way and the backfill in 20261002000001 links them later — so it's a
   * separate field rather than a reason to fail.
   */
  memberId: string | null
}

/** What a brought-along guest's contact carries: course access, plus how they
 *  arrived. Written to GHL and mirrored onto the member row below. */
const GUEST_TAGS: string[] = [...ALL_ACCESS_TAGS, MEMBER_GUEST_TAG]

/**
 * Creates (or finds) the guest's GHL contact, tags it for access, and makes
 * sure a LinkUp member exists for it.
 *
 * Returns the GHL contact id — the caller needs it to book the appointment —
 * and the member id, which the caller puts on the booking row so the round
 * belongs to them. Throws only if the contact itself can't be resolved, since
 * without one there is no appointment to make. A failure to create the member
 * row is logged and swallowed, and comes back as a null member id: the guest is
 * on the round either way, and the daily GHL sync will pick them up.
 */
export async function provisionNonMemberGuest(
  guest: NonMemberGuest,
  admin: SupabaseClient
): Promise<ProvisionedGuest> {
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
  //
  // MEMBER_GUEST_TAG goes on alongside them: the access tags are what a paying
  // member carries, so without it this contact is indistinguishable in GHL from
  // someone who bought a membership. It's how they got here, and it's the tag
  // GHL segments the follow-up on.
  for (const tag of GUEST_TAGS) {
    await addTagToContact(contactId, tag)
  }

  let memberId: string | null = null
  try {
    memberId = await ensureMemberForContact({ admin, contactId, guest, email })
  } catch (err) {
    logger.error('Non-member guest — member sync failed (non-fatal)', {
      action: 'non_member_guest.sync_failed',
      errorMessage: err instanceof Error ? err.message : String(err),
    })
  }

  return { contactId, memberId }
}

/**
 * Hands the booking row to the member this guest has just become.
 *
 * A booking has always been one row per player, so the guest's seat is already
 * its own record — what it lacked was a link back to the person sitting in it.
 * Without one the round existed only as a name on the booker's list: the guest
 * was provisioned a member account, could sign in, and saw nothing, because
 * player_member_id is the only link GET /api/bookings reads to show somebody a
 * round they didn't book themselves.
 *
 * The stored player object is updated alongside it, so a provisioned guest's row
 * ends up indistinguishable from a member invited by name — the same shape the
 * 20260708000001 backfill wrote, and the shape its successor still looks for.
 * It replaces the array, which is safe for the rows this is called with: the
 * routes pass a row they just inserted, and those carry exactly one player.
 *
 * Best-effort. The seat and the appointment are already made, so nothing here is
 * worth failing a booking over, and a row this misses is picked up by the
 * backfill in 20261002000001.
 */
export async function linkGuestToMember(
  admin: SupabaseClient,
  params: { bookingId: string; guest: NonMemberGuest; memberId: string }
): Promise<void> {
  const { bookingId, guest, memberId } = params

  const { error } = await admin
    .from('bookings')
    .update({
      player_member_id: memberId,
      additional_players: [{ ...guest, memberId, isNonMember: false }],
    })
    .eq('id', bookingId)
    // Never overwrite a link somebody else already made — two seats naming the
    // same new guest race through provisioning, and an admin may have linked
    // the row by hand.
    .is('player_member_id', null)

  if (error) {
    logger.error('Non-member guest — booking link failed (non-fatal)', {
      action: 'non_member_guest.link_failed',
      errorMessage: error.message,
      metadata: { bookingId },
    })
  }
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
}): Promise<string> {
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
    tags: [...GUEST_TAGS],
    customFields: [],
  }

  await syncMember({ contact, userId: memberUserId, ctx: { supabase: admin } })

  return memberUserId
}
