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
