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

// ---- One non-member per booking --------------------------------------------
//
// Where a venue does take them, a booking brings at most one. Everyone else the
// booker adds has to be a LinkUp member. Counted across the whole booking, not
// per request — the cap would mean nothing if a second guest could come in
// through Add player after the round was made.

/** How many non-member guests one booking may bring. */
export const MAX_NON_MEMBER_GUESTS = 1

/** What a booker is told when they try to add a second. */
export const NON_MEMBER_GUEST_LIMIT_MESSAGE =
  'A booking can include one non-member guest. Anyone else you add needs to be a LinkUp member.'

/**
 * Whether a booking already holding `seated` non-member guests can take
 * `adding` more.
 */
export function withinNonMemberGuestLimit(seated: number, adding: number): boolean {
  return seated + adding <= MAX_NON_MEMBER_GUESTS
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
