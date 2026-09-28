// Setting a host up in GHL.
//
// Becoming a host used to grant the role here and leave the other half of the
// job on somebody's list: create the person a GHL user, create the calendar for
// their venue, put the user on the calendar. Until all three happened the
// venue's appointments were assigned to GHL_DEFAULT_ASSIGNEE_ID — a user with
// no connection to the club, and the person the host's own members would show
// up as booked with.
//
// So it happens as part of becoming one instead. Four entry points:
//
//   provisionGhlUser     — the account alone, before there is a hosts row to
//                          hang it on. POST /api/host/application calls this
//                          first and refuses to go on without it.
//   ensureHostGhlUser    — the same for a host who already exists, writing the
//                          id back. Idempotent: a host who is already a GHL
//                          user (staff, a partner, someone set up by hand)
//                          keeps that account.
//   hostUserIdsForCourse — when the venue's calendar is created, so it is built
//                          staffed by the hosts who are going to run it.
//   ensureCourseCalendar — when a venue a host may use has no calendar: on
//                          becoming a host, and on listing a round. Creating it
//                          here rather than waiting for an admin is the point —
//                          the round is submitted and the thing it books
//                          against already exists.
//   syncHostAvailability — straight after, and again whenever the host's dates
//                          change. A calendar with a user on it and no schedule
//                          offers that user's default availability, which is
//                          every weekday all day; this narrows it to the tee
//                          times the host actually listed.
//
// The calendar half is best-effort: the rounds belong to the host and a GHL
// outage must not take them back. The user half is not, on the one path where
// it's a prerequisite. Every failure is logged rather than swallowed — the gap
// is meant to be visible.

import type { SupabaseClient } from '@supabase/supabase-js'
import { createGHLCalendar, ensureGHLUser, setGHLCalendarSchedule } from '@/lib/ghl/client'
import { GHL_CALENDAR_RULES } from '@/lib/constants'
import { availabilityRules, OCCUPYING_STATUSES } from '@/lib/hosts/schedule'
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
 * A GHL user for this person, before there is anything in our database to hang
 * it on.
 *
 * Split out of ensureHostGhlUser because becoming a host now does this first:
 * the account is the prerequisite, and the hosts row is created carrying its
 * id rather than being patched afterwards. That ordering is what removes the
 * half-state — a host who exists here and nowhere in GHL, whose venue's
 * appointments fall to a default user nobody at the club has heard of.
 *
 * Returns null when there is no email to use, or GHL wouldn't take it. Callers
 * decide whether that is fatal; it is for a new host, and isn't for a calendar
 * being created for one who already exists.
 */
export async function provisionGhlUser(
  person: HostPerson,
  displayName: string,
): Promise<{ userId: string; created: boolean } | null> {
  const email = person.email?.trim()
  if (!email) {
    logger.warn('GHL user not provisioned: no email on the member', {
      action: 'host.ghl_user.skipped',
      metadata: { displayName },
    })
    return null
  }

  // The person's own name where we have it, and their display name as the
  // fallback — a GHL user with an empty surname is worse than a repeated one.
  const first = person.first_name?.trim() || displayName.split(' ')[0] || displayName
  const last = person.last_name?.trim() || displayName.split(' ').slice(1).join(' ') || 'Host'

  const result = await ensureGHLUser({
    firstName: first,
    lastName: last,
    email,
    phone: person.phone ?? null,
  })

  return result ? { userId: result.user.id, created: result.created } : null
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

  const result = await provisionGhlUser(person, host.name)
  if (!result) return null

  const { error } = await admin
    .from('hosts')
    .update({ ghl_user_id: result.userId })
    .eq('id', host.id)

  if (error) {
    // The GHL user exists either way; losing the link only means we look it up
    // by email next time.
    logger.warn('Host GHL user created but not linked', {
      action: 'host.ghl_user.link_failed',
      metadata: { host_id: host.id, ghl_user_id: result.userId, error: error.message },
    })
  }

  logger.info('Host GHL user ready', {
    action: 'host.ghl_user.ready',
    metadata: { host_id: host.id, ghl_user_id: result.userId, created: result.created },
  })

  return result.userId
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
 * Writes the host's availability for one venue into GHL.
 *
 * Called after the venue's calendar exists and whenever the host's dates at it
 * change. A calendar offers members whatever the users staffing it are free for,
 * and a new GHL user is free every weekday all day — so without this a venue
 * with three hosted rounds on it was bookable every working day of the next six
 * months.
 *
 * The schedule replaces itself: its id is kept on the host_venues row, so the
 * host's dates are restated rather than stacked up as one schedule per edit.
 *
 * Returns the schedule id, or null when there was nothing to write or GHL
 * wouldn't take it. Best-effort, like everything else here — the rounds are
 * already the host's.
 */
export async function syncHostAvailability(
  admin: SupabaseClient,
  params: {
    hostId: string
    courseId: string
    calendarId: string
    ghlUserId: string
    /** The venue's timezone; the rules' clock values are read in it. */
    timezone?: string | null
  },
): Promise<string | null> {
  const timezone = params.timezone?.trim()
  if (!timezone) {
    logger.warn('Host availability not written: venue has no timezone', {
      action: 'host.availability.skipped',
      metadata: { host_id: params.hostId, course_id: params.courseId },
    })
    return null
  }

  // Only the rounds still ahead of us, and only the ones that hold a tee time —
  // a cancelled or finished round is not availability.
  const today = new Date().toISOString().slice(0, 10)
  const { data: rounds, error } = await admin
    .from('hosted_events')
    .select('event_date, tee_time')
    .eq('host_id', params.hostId)
    .eq('course_id', params.courseId)
    .gte('event_date', today)
    .in('status', [...OCCUPYING_STATUSES])

  if (error) {
    logger.warn('Host availability not written: could not read the rounds', {
      action: 'host.availability.read_failed',
      metadata: { host_id: params.hostId, course_id: params.courseId, error: error.message },
    })
    return null
  }

  const rules = availabilityRules(
    (rounds ?? []).map(r => ({
      date: String(r.event_date),
      teeTime: (r.tee_time as string | null) ?? null,
    })),
    GHL_CALENDAR_RULES.slotDuration,
  )

  // No dates: leave the schedule alone rather than writing an empty one. An
  // empty rule set reads as "never available", which would take down a calendar
  // whose rounds simply haven't been listed yet.
  if (rules.length === 0) {
    logger.info('Host availability unchanged: no upcoming rounds to publish', {
      action: 'host.availability.empty',
      metadata: { host_id: params.hostId, course_id: params.courseId },
    })
    return null
  }

  const { data: venue } = await admin
    .from('host_venues')
    .select('ghl_schedule_id')
    .eq('host_id', params.hostId)
    .eq('course_id', params.courseId)
    .maybeSingle()

  const scheduleId = await setGHLCalendarSchedule({
    calendarId: params.calendarId,
    userId: params.ghlUserId,
    timezone,
    rules,
    scheduleId: (venue?.ghl_schedule_id as string | null) ?? null,
  })

  if (!scheduleId) return null

  if (scheduleId !== venue?.ghl_schedule_id) {
    const { error: linkError } = await admin
      .from('host_venues')
      .update({ ghl_schedule_id: scheduleId })
      .eq('host_id', params.hostId)
      .eq('course_id', params.courseId)

    if (linkError) {
      // The schedule is live in GHL; losing the link only means the next sync
      // creates a second one rather than replacing this.
      logger.warn('Host availability written but not linked', {
        action: 'host.availability.link_failed',
        metadata: {
          host_id: params.hostId,
          course_id: params.courseId,
          schedule_id: scheduleId,
          error: linkError.message,
        },
      })
    }
  }

  logger.info('Host availability published', {
    action: 'host.availability.ok',
    metadata: {
      host_id: params.hostId,
      course_id: params.courseId,
      calendar_id: params.calendarId,
      schedule_id: scheduleId,
      dates: rules.length,
    },
  })

  return scheduleId
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
