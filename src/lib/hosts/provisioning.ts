// Setting a host up in GHL.
//
// Approving a host used to grant them a role here and leave the other half of
// the job on somebody's list: create the person a GHL user, create the calendar
// for their venue, put the user on the calendar. Until all three happened the
// venue's appointments were assigned to GHL_DEFAULT_ASSIGNEE_ID — a user with
// no connection to the club, and the person the host's own members would show
// up as booked with.
//
// So it happens on approval instead. Two entry points:
//
//   ensureHostGhlUser   — when the host is approved. Idempotent: a host who is
//                         already a GHL user (staff, a partner, someone set up
//                         by hand) keeps that account.
//   hostUserIdsForCourse — when the venue's calendar is created, so it is built
//                         staffed by the hosts who are going to run it.
//
// Best-effort throughout. Creating a GHL user needs an agency-scoped token, and
// a location-scoped install simply can't; the host's role in LinkUp is the
// hosts row, so an approval must not fail because a second system said no. Every
// failure is logged rather than swallowed — the gap is meant to be visible.

import type { SupabaseClient } from '@supabase/supabase-js'
import { ensureGHLUser } from '@/lib/ghl/client'
import { logger } from '@/lib/logger'

export interface HostPerson {
  first_name?: string | null
  last_name?: string | null
  email?: string | null
  phone?: string | null
}

/**
 * The host's GHL user id, creating the account if they don't have one.
 *
 * Returns null when there's nothing to work with (no email) or GHL wouldn't
 * take it. The id is written back to hosts.ghl_user_id so the next calendar at
 * one of their venues can be staffed without asking GHL again.
 */
export async function ensureHostGhlUser(
  admin: SupabaseClient,
  host: { id: string; name: string; ghl_user_id?: string | null },
  person: HostPerson,
): Promise<string | null> {
  if (host.ghl_user_id) return host.ghl_user_id

  const email = person.email?.trim()
  if (!email) {
    logger.warn('Host GHL user not provisioned: no email on the member', {
      action: 'host.ghl_user.skipped',
      metadata: { host_id: host.id },
    })
    return null
  }

  // The host's own name where we have it, and their display name as the
  // fallback — a GHL user with an empty surname is worse than a repeated one.
  const first = person.first_name?.trim() || host.name.split(' ')[0] || host.name
  const last = person.last_name?.trim() || host.name.split(' ').slice(1).join(' ') || 'Host'

  const result = await ensureGHLUser({
    firstName: first,
    lastName: last,
    email,
    phone: person.phone ?? null,
  })

  if (!result) return null

  const { error } = await admin
    .from('hosts')
    .update({ ghl_user_id: result.user.id })
    .eq('id', host.id)

  if (error) {
    // The GHL user exists either way; losing the link only means we look it up
    // by email next time.
    logger.warn('Host GHL user created but not linked', {
      action: 'host.ghl_user.link_failed',
      metadata: { host_id: host.id, ghl_user_id: result.user.id, error: error.message },
    })
  }

  logger.info('Host GHL user ready', {
    action: 'host.ghl_user.ready',
    metadata: { host_id: host.id, ghl_user_id: result.user.id, created: result.created },
  })

  return result.user.id
}

/**
 * The GHL users of every host granted this venue — who a calendar created for
 * it should be staffed by.
 *
 * Usually one. A venue two hosts share gets both, first one primary, which is
 * what GHL's own round-robin expects.
 */
export async function hostUserIdsForCourse(
  admin: SupabaseClient,
  courseId: string,
): Promise<string[]> {
  const { data } = await admin
    .from('host_venues')
    .select('host:hosts(ghl_user_id, status)')
    .eq('course_id', courseId)

  const ids: string[] = []
  for (const row of data ?? []) {
    const host = Array.isArray(row.host) ? row.host[0] : row.host
    const typed = host as { ghl_user_id?: string | null; status?: string } | null
    if (typed?.status !== 'active') continue
    const id = typed.ghl_user_id?.trim()
    if (id && !ids.includes(id)) ids.push(id)
  }
  return ids
}
