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
//   ensureCourseCalendar — when a host lists their first round at a venue that
//                         has no calendar. Creating it here rather than waiting
//                         for an admin is the point: the round is submitted and
//                         the thing it books against already exists.
//
// Best-effort throughout. Creating a GHL user needs an agency-scoped token, and
// a location-scoped install simply can't; the host's role in LinkUp is the
// hosts row, so an approval must not fail because a second system said no. Every
// failure is logged rather than swallowed — the gap is meant to be visible.

import type { SupabaseClient } from '@supabase/supabase-js'
import { createGHLCalendar, ensureGHLUser } from '@/lib/ghl/client'
import { logger } from '@/lib/logger'

/** One colour for every host-made calendar, so they read as a set in GHL. */
const CALENDAR_COLOUR = '#16a34a'

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

/**
 * The venue's GHL calendar, creating it if the venue hasn't got one.
 *
 * Called when a host lists rounds at a club: a venue the host proposed arrives
 * with no calendar at all, and until one exists the round can't be published no
 * matter how quickly it's reviewed. Making it at submission time means the
 * admin's job is a decision rather than a setup.
 *
 * Returns the calendar id, or null when it couldn't be made. Never throws: the
 * rounds are already the host's and must not be lost because GHL was down. Both
 * outcomes are logged — createGHLCalendar logs the GHL side, this logs which
 * venue and host it was for.
 */
export async function ensureCourseCalendar(
  admin: SupabaseClient,
  course: {
    id: string
    name: string
    slug: string
    ghl_calendar_id?: string | null
    address?: string | null
    city?: string | null
    state?: string | null
    meeting_interval_mins?: number | null
    meeting_duration_mins?: number | null
    min_scheduling_notice_mins?: number | null
    date_range_days?: number | null
    pre_buffer_mins?: number | null
    post_buffer_mins?: number | null
    seats_per_class?: number | null
  },
  teamMemberIds: string[],
): Promise<string | null> {
  if (course.ghl_calendar_id) return course.ghl_calendar_id

  logger.info('Venue has no GHL calendar; creating one', {
    action: 'host.calendar.start',
    metadata: { course_id: course.id, course: course.name, teamMembers: teamMemberIds },
  })

  let calendarId: string
  try {
    calendarId = await createGHLCalendar({
      // The event the host named — for a club they proposed, the course row is
      // that event, so its name is what the calendar is called in GHL.
      name: course.name,
      slug: course.slug,
      eventColor: CALENDAR_COLOUR,
      address: [course.address, course.city, course.state].filter(Boolean).join(', '),
      meetingIntervalMins: course.meeting_interval_mins ?? 0,
      meetingDurationMins: course.meeting_duration_mins ?? 0,
      minSchedulingNoticeMins: course.min_scheduling_notice_mins ?? 0,
      dateRangeDays: course.date_range_days ?? 0,
      preBufferMins: course.pre_buffer_mins ?? 0,
      postBufferMins: course.post_buffer_mins ?? 0,
      seatsPerClass: course.seats_per_class ?? null,
      teamMemberIds,
    })
  } catch (err) {
    logger.error('Venue calendar not created', {
      action: 'host.calendar.failed',
      errorMessage: String(err),
      metadata: { course_id: course.id, course: course.name },
    })
    return null
  }

  const { error } = await admin
    .from('courses')
    .update({ ghl_calendar_id: calendarId })
    .eq('id', course.id)

  if (error) {
    // The calendar exists in GHL but nothing here points at it, which is worse
    // than not having made it: the next call would make a second one. Loud.
    logger.error('Venue calendar created but not linked to the course', {
      action: 'host.calendar.link_failed',
      metadata: { course_id: course.id, calendar_id: calendarId, error: error.message },
    })
    return null
  }

  logger.info('Venue calendar ready', {
    action: 'host.calendar.ok',
    metadata: { course_id: course.id, course: course.name, calendar_id: calendarId },
  })
  return calendarId
}
