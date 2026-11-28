// Who may do what in a community. Pure, so it's tested; the one place these
// rules live, for the admin screens, the API routes and (from Release 2) the
// community calendar's events.
//
// Agreed with Greg (2026-11-28):
//   * Admins (`members.is_admin`) act everywhere: any community, any venue,
//     any event.
//   * A Captain acts only in their own community: approves its venues and its
//     hosts, and adds, changes or deletes any event at any of its venues.
//   * A Host adds, changes or deletes events only at venues they've been
//     approved for (`host_venues.status = 'approved'`). A venue may have several
//     hosts, and each event names its own.
//   * Approving a host or a venue is the Captain's (or an admin's) call, never
//     the host's.
//
// Schema: communities, courses.community_id, host_venues.status
// (20261128000003).

export interface Actor {
  memberId: string
  isAdmin: boolean
  /** Communities this member captains. */
  captainOf: readonly string[]
  /** Venues this member is an approved host at. */
  hostVenueIds: readonly string[]
}

/** As much of a venue as the rules need. */
export interface VenueRef {
  id: string
  community_id: string | null
}

export const NO_ACCESS: Omit<Actor, 'memberId'> = { isAdmin: false, captainOf: [], hostVenueIds: [] }

export function isCaptainOf(actor: Actor, communityId: string | null | undefined): boolean {
  return !!communityId && actor.captainOf.includes(communityId)
}

/** Runs the community: its settings, its venues, its hosts. */
export function canManageCommunity(actor: Actor, communityId: string | null | undefined): boolean {
  return actor.isAdmin || isCaptainOf(actor, communityId)
}

/** Approves (or declines) a venue proposed for the community. */
export function canApproveVenue(actor: Actor, venue: VenueRef): boolean {
  return canManageCommunity(actor, venue.community_id)
}

/** Approves (or revokes) a host at one of the community's venues. */
export function canApproveHostAt(actor: Actor, venue: VenueRef): boolean {
  return canManageCommunity(actor, venue.community_id)
}

/** Adds, changes or deletes an event at this venue. */
export function canManageEventsAt(actor: Actor, venue: VenueRef): boolean {
  return canManageCommunity(actor, venue.community_id) || actor.hostVenueIds.includes(venue.id)
}

/** Whether this member sees the admin module at all (whole or community-scoped). */
export function canOpenAdmin(actor: Actor): boolean {
  return actor.isAdmin || actor.captainOf.length > 0
}

/**
 * The communities this member's admin screens cover: every one for an admin
 * (`'all'`), their own for a Captain, none otherwise.
 */
export function adminScope(actor: Actor): 'all' | readonly string[] {
  return actor.isAdmin ? 'all' : actor.captainOf
}

/** Keeps the rows an admin scope covers. A row with no community is admin-only. */
export function withinScope<T extends { community_id: string | null }>(
  rows: readonly T[],
  scope: 'all' | readonly string[],
): T[] {
  if (scope === 'all') return [...rows]
  return rows.filter(r => !!r.community_id && scope.includes(r.community_id))
}

/** The venues a member may list events at, out of a set of venues. */
export function venuesForEvents<T extends VenueRef>(actor: Actor, venues: readonly T[]): T[] {
  return venues.filter(v => canManageEventsAt(actor, v))
}
