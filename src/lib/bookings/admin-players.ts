// Players an admin adds to a tee time by name.
//
// From /admin/bookings an admin can put anyone on any tee time: a name
// (required) and an email and phone if they have them. Nothing here asks
// whether the person is a member or a guest, and nothing limits how many —
// not the venue's non-member guest setting, not four to a booking, not the
// venue's daily cap, not the open-days window and not the payment gate. Those
// are rules for members booking for themselves; an admin adding a player is
// the club deciding.
//
// What happens to each player is decided by what the admin typed
// (POST /api/admin/bookings):
//   * an email that belongs to an account — the seat is their own round, so
//     it's in their app and they get the reminders (adminSeatOwnership);
//   * an email with no account — a GHL contact and a guest login are made for
//     them (provisionNonMemberGuest), and the seat is theirs the same way;
//   * no email — a GHL contact from the name (and phone, if given), so the
//     seat still comes off the GHL calendar's supply. There's no login to
//     make without an address, so nobody to remind.
//
// Pure: validation and the row shape. Tested in admin-players.test.ts.

import { validateEmail } from '@/lib/validation'
import type { AdditionalPlayer } from '@/types'

export interface AdminPlayerInput {
  name: string
  email?: string | null
  phone?: string | null
}

/** A player as the route works with them: trimmed, split, validated. */
export interface AdminPlayer {
  name: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
}

export const ADMIN_PLAYER_NAME_MAX = 100

/**
 * The name as first and last, for GHL, which keeps them apart: the first word,
 * and everything after it. "Mary Ann Smith" is Mary / Ann Smith — wrong for a
 * few people, but it is only what GHL files the contact under; the name on the
 * tee sheet is the one typed.
 */
export function splitName(name: string): { firstName: string; lastName: string } {
  const words = name.trim().split(/\s+/).filter(Boolean)
  return { firstName: words[0] ?? '', lastName: words.slice(1).join(' ') }
}

/**
 * Checks and normalises the players an admin entered.
 *
 * A name is the only thing asked for. An email, when given, has to be one
 * (it's what the person signs in with); a phone, when given, needs at least
 * seven digits. An empty list is refused — there'd be nothing to add — but
 * there's no upper limit.
 */
export function parseAdminPlayers(
  input: unknown,
): { ok: true; players: AdminPlayer[] } | { ok: false; error: string } {
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, error: 'Add at least one player.' }
  }

  const players: AdminPlayer[] = []
  for (const [i, raw] of input.entries()) {
    const p = (raw ?? {}) as Partial<AdminPlayerInput>
    const which = input.length > 1 ? `Player ${i + 1}` : 'The player'
    const name = typeof p.name === 'string' ? p.name.trim().replace(/\s+/g, ' ') : ''
    if (!name) return { ok: false, error: `${which} needs a name.` }
    if (name.length > ADMIN_PLAYER_NAME_MAX) {
      return { ok: false, error: `${which}'s name must be ${ADMIN_PLAYER_NAME_MAX} characters or fewer.` }
    }

    const email = typeof p.email === 'string' && p.email.trim() ? p.email.trim().toLowerCase() : null
    if (email && !validateEmail(email).valid) {
      return { ok: false, error: `${which}'s email isn't a valid address.` }
    }

    const phone = typeof p.phone === 'string' && p.phone.trim() ? p.phone.trim() : null
    if (phone && phone.replace(/\D/g, '').length < 7) {
      return { ok: false, error: `${which}'s phone number looks too short.` }
    }

    players.push({ name, ...splitName(name), email, phone })
  }
  return { ok: true, players }
}

/** 'HH:MM' or 'HH:MM:SS' → 'HH:MM:SS', or null when it isn't a time of day. */
export function normaliseTeeTime(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(value.trim())
  if (!m) return null
  return `${m[1]}:${m[2]}:${m[3] ?? '00'}`
}

/**
 * Whose round the seat is, as the booking row records it.
 *
 * A player with an account gets it as their own round — the same row they'd
 * have if they had booked it themselves (member_id them, no guest_name). That
 * is what puts it in their app as a plain booking of theirs, lets them cancel
 * it, puts them on the who's-playing list, and gets them the reminders. It is
 * deliberately not an "added player" row: those belong to a booker's group and
 * would read "invited by" the admin.
 *
 * A player with no account has nobody to own the round, and member_id can't be
 * empty, so the admin who added them books it, under the player's name. That
 * row is hidden from the admin's own My Bookings (isSeatAdminRecordedForOthers).
 */
export function adminSeatOwnership(
  p: AdminPlayer,
  memberId: string | null,
  adminId: string,
): {
  member_id: string
  guest_name: string | null
  player_member_id: null
  additional_players: AdditionalPlayer[]
  invite_status: null
} {
  if (memberId) {
    return { member_id: memberId, guest_name: null, player_member_id: null, additional_players: [], invite_status: null }
  }
  return {
    member_id: adminId,
    guest_name: p.name,
    player_member_id: null,
    additional_players: [{
      firstName: p.firstName,
      lastName: p.lastName,
      email: p.email ?? '',
      mobile: p.phone ?? '',
      isNonMember: false,
      paidBy: 'self',
    }],
    // Placed, not invited: nobody is asked to answer, and the invitation cron
    // (which only touches 'pending') never frees the seat.
    invite_status: null,
  }
}

/**
 * A named seat an admin recorded for somebody with no account, seen from the
 * admin's side. The admin is its booker only because a row has to name one;
 * it isn't theirs to see in My Bookings, pay for, or cancel.
 */
export function isSeatAdminRecordedForOthers(
  row: { member_id: string; guest_name: string | null; added_by_admin_id?: string | null },
  viewerId: string,
): boolean {
  return !!row.added_by_admin_id && row.member_id === viewerId && !!row.guest_name
}
