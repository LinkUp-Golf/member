// Whether a venue lets a member bring someone who isn't a LinkUp member.
//
// Adding a fellow member to a round is always allowed. Adding a non-member —
// who is then provisioned a GHL contact and a member row of their own — is the
// venue's call, made by an admin on the course (courses.allow_non_member_guests,
// off by default). The booking screen, the add-player sheet, the admin
// booking form and both booking routes all ask this one function, so a guest
// the screen won't offer is one the server won't take either.

/** What a booker is told when they try anyway. */
export const NON_MEMBER_GUESTS_DISABLED_MESSAGE =
  "This venue doesn't take non-member guests. You can still add LinkUp members."

/**
 * Whether non-member guests may be added at this venue. A course we couldn't
 * load answers no — the setting defaults to off, and so does not knowing it.
 */
export function allowsNonMemberGuests(
  course: { allow_non_member_guests?: boolean | null } | null | undefined,
): boolean {
  return course?.allow_non_member_guests === true
}

// ---- Non-members per booking -----------------------------------------------
//
// Where a venue does take them, a booking brings at most the venue's number
// (courses.max_non_member_guests, set by an admin beside the switch; 1 unless
// changed). Everyone else the booker adds has to be a LinkUp member. Counted
// across the whole booking, not per request — the cap would mean nothing if
// another guest could come in through Add player after the round was made.

/** A venue's cap when it hasn't set one — the rule every venue had before. */
export const DEFAULT_MAX_NON_MEMBER_GUESTS = 1

/**
 * The column is a Postgres integer. Not a rule about guests — the venue's
 * number is whatever the admin sets — only the most the column can store, so an
 * absurd entry is refused with a message instead of failing the write.
 */
const INT4_MAX = 2_147_483_647

/**
 * How many non-member guests one booking may bring at this venue. Meaningful
 * only where allowsNonMemberGuests says yes. The tee time's open spots still
 * bound the booking as a whole.
 */
export function maxNonMemberGuests(
  course: { max_non_member_guests?: number | null } | null | undefined,
): number {
  const n = Number(course?.max_non_member_guests)
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_MAX_NON_MEMBER_GUESTS
}

/**
 * An admin's choice as a cap, or null when it isn't one (not a whole number of
 * at least 1). The course routes refuse null rather than guess, so what's saved
 * is what the admin entered.
 */
export function parseMaxNonMemberGuests(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isInteger(n)) return null
  return n >= 1 && n <= INT4_MAX ? n : null
}

export const MAX_NON_MEMBER_GUESTS_INVALID_MESSAGE =
  'Non-member guests per booking must be a whole number, 1 or more'

/** What a booker is told once the booking holds as many as the venue takes. */
export function nonMemberGuestLimitMessage(limit: number): string {
  const allowance = limit === 1 ? 'one non-member guest' : `up to ${limit} non-member guests`
  return `A booking can include ${allowance}. Anyone else you add needs to be a LinkUp member.`
}

/**
 * Whether a booking already holding `seated` non-member guests can take
 * `adding` more, at a venue that takes `limit` (maxNonMemberGuests).
 */
export function withinNonMemberGuestLimit(seated: number, adding: number, limit: number): boolean {
  return seated + adding <= limit
}

/**
 * Whether one seat on a booking is held by a non-member guest.
 *
 * A non-member's row is written naming a guest and no member, and then linked
 * to the guest account provisioning makes for them (linkGuestToMember) — which
 * also rewrites the stored player as a member's. So once linked, the row alone
 * can't say; the account behind it can. `guestAccountIds` is the members among
 * the linked seats who hold a guest account and no membership (isGuestOnly).
 * The booker's own row names no guest and is never one.
 */
export function isNonMemberSeat(
  seat: { guest_name: string | null; player_member_id: string | null },
  guestAccountIds: ReadonlySet<string>,
): boolean {
  if (!seat.guest_name) return false
  return seat.player_member_id ? guestAccountIds.has(seat.player_member_id) : true
}
