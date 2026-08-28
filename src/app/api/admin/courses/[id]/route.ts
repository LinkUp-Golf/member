export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { createGHLCalendar, deleteGHLCalendar, getCalendarBookingRules } from '@/lib/ghl/client'
import { validateTimezone, sanitiseText } from '@/lib/validation'
import { activeCourseIds, postAnnouncementToCourses } from '@/lib/announcements/fan-out'
import { APPROVABLE_STATUSES, canApproveEvent } from '@/lib/hosts/events'
import { openSpotsByDate } from '@/lib/bookings/availability'
import { sendPushToMember, NotificationTemplates } from '@/lib/push'
import { MAX_PINNED_COURSES } from '@/lib/constants'
import { logger } from '@/lib/logger'
import type { AuthContext } from '@/lib/auth/types'
import type { Course } from '@/types'

const CALENDAR_COLORS = ['#16a34a', '#0ea5e9', '#8b5cf6', '#f59e0b', '#ef4444', '#ec4899']
function randomColor() { return CALENDAR_COLORS[Math.floor(Math.random() * CALENDAR_COLORS.length)] ?? '#16a34a' }

function isValidUrl(url: string): boolean {
  try {
    const p = new URL(url)
    return p.protocol === 'https:' || p.protocol === 'http:'
  } catch { return false }
}

export const PATCH = withAuth(
  async (req: NextRequest, ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing course id' }, { status: 400 })

    const body = await req.json() as Partial<Course> & { action?: string; rejection_reason?: string }
    const admin = createAdminClient()

    // Approve or reject a pending course
    if (body.action === 'approve' || body.action === 'reject') {
      const { data: course } = await admin.from('courses').select('*').eq('id', id).single()
      if (!course) return NextResponse.json({ error: 'Course not found' }, { status: 404 })
      if (course.approval_status !== 'pending') return NextResponse.json({ error: 'Course is not pending' }, { status: 409 })

      if (body.action === 'approve') {
        // Approving is what publishes a course to members, so it has to clear
        // the bar the member endpoints actually apply. GET /api/courses and
        // GET /api/bookings/availability both require a payment link — a
        // confirmed booking is sent to courses.payment_url to be paid, so a
        // course without one has nowhere to send anybody.
        //
        // A course an admin created can't get here without one (POST requires
        // it). A course a host proposed arrives with none at all, and approving
        // it used to succeed and produce a course that was active, calendared,
        // and invisible — with nothing saying why.
        if (!(course.payment_url as string | null)?.trim()) {
          return NextResponse.json(
            {
              error:
                'Add a payment link before approving. Without one this course stays hidden from members, because a confirmed booking has nowhere to be paid — edit the course, add the link, then approve.',
            },
            { status: 400 }
          )
        }

        let ghlCalendarId = course.ghl_calendar_id as string | null
        if (!ghlCalendarId) {
          try {
            ghlCalendarId = await createGHLCalendar({
              name: course.name,
              slug: course.slug,
              eventTitle: `LinkUp @ ${course.name}`,
              eventColor: randomColor(),
              meetingIntervalMins: course.meeting_interval_mins,
              meetingDurationMins: course.meeting_duration_mins,
              minSchedulingNoticeMins: course.min_scheduling_notice_mins,
              dateRangeDays: course.date_range_days,
              preBufferMins: course.pre_buffer_mins,
              postBufferMins: course.post_buffer_mins,
              seatsPerClass: course.seats_per_class,
            })
          } catch (err) {
            return NextResponse.json({ error: `GHL calendar creation failed: ${String(err)}` }, { status: 502 })
          }
        }
        const { data, error } = await admin
          .from('courses')
          .update({ approval_status: 'active', ghl_calendar_id: ghlCalendarId, reviewed_by: ctx.userId })
          .eq('id', id).select().single()
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })

        // Publish the rounds that were only ever waiting on this.
        //
        // A host proposing a venue creates the rounds they want there as real
        // hosted_events in 'pending_approval', and the one thing holding them
        // back is the calendar behind them — which approving the course is what
        // creates. So the events go live here rather than needing a second pass
        // through the hosted-events queue: the admin has already made the
        // decision this asks for, and leaving them pending left the host
        // reading "we're setting up the calendar" about a calendar that now
        // exists.
        //
        // Two gates, not one.
        //
        // canApproveEvent, as when approving by hand: only rounds still awaiting
        // approval, and never one whose date has gone.
        //
        // Then the calendar. A host proposing a venue picks the dates they want
        // before the venue has a calendar to ask, so those dates are a request,
        // not availability — and the calendar an admin then sets up is free to
        // disagree with every one of them. Publishing a round on a day the venue
        // has nothing open lists something no member can actually play, and it
        // makes the host's wishlist look like availability on a screen whose
        // whole job is to report what the venue has.
        //
        // So the calendar decides: a date it holds open is published (with the
        // capacity it actually has, replacing the number the host guessed at),
        // and a date it doesn't is left awaiting approval for an admin to sort
        // out with the host. Left, not rejected — the host asked for something
        // real, and the answer is a conversation rather than a deletion.
        let publishedEvents = 0
        let heldEvents = 0
        // Hosts who've already heard about this approval through their rounds.
        // The venue notice below is for whoever hasn't.
        const notified = new Set<string>()
        try {
          const { data: waiting } = await admin
            .from('hosted_events')
            .select('id, status, event_date, host:hosts(member_id)')
            .eq('course_id', id)
            .in('status', [...APPROVABLE_STATUSES])

          const approvable = (waiting ?? []).filter(
            e => canApproveEvent(e.status as string, e.event_date as string).ok,
          )

          if (approvable.length) {
            // `data` carries the calendar id this approval just created, which
            // is what makes there be anything to ask.
            const openByDate = await openSpotsByDate(
              admin,
              data as Course,
              Array.from(new Set(approvable.map(e => String(e.event_date)))),
            )

            const supported = approvable.filter(e => (openByDate.get(String(e.event_date)) ?? 0) > 0)
            const held = approvable.filter(e => !supported.includes(e))
            heldEvents = held.length

            // Capacity per date, so each round is listed with what its own day
            // has room for — two days at the same club rarely match.
            for (const event of supported) {
              const date = String(event.event_date)
              await admin
                .from('hosted_events')
                .update({
                  status: 'upcoming',
                  total_spots: openByDate.get(date),
                  reviewed_by: ctx.userId,
                  reviewed_at: new Date().toISOString(),
                  rejection_reason: null,
                })
                .eq('id', event.id)
                // The status filter is the race guard, exactly as it is on the
                // single-event route: a host cancelling mid-review must win.
                .in('status', [...APPROVABLE_STATUSES])
              publishedEvents += 1
            }

            // One piece of news per host per fact, not one per date — a host
            // with five rounds here doesn't want five notifications.
            const hostOf = (e: { host?: unknown }) => {
              const host = Array.isArray(e.host) ? e.host[0] : e.host
              return (host as { member_id?: string } | null)?.member_id ?? null
            }

            // Published: told about their own soonest date, the one they'll act
            // on first.
            const soonestByHost = new Map<string, string>()
            for (const e of supported) {
              const memberId = hostOf(e)
              if (!memberId) continue
              const date = String(e.event_date)
              const standing = soonestByHost.get(memberId)
              if (!standing || date < standing) soonestByHost.set(memberId, date)
            }
            for (const [memberId, date] of soonestByHost) {
              void sendPushToMember(
                memberId,
                NotificationTemplates.hostedEventApproved(data.name, date),
              ).catch(() => {})
              notified.add(memberId)
            }

            // Held: told how many, because this one needs them to do something.
            // They picked those dates before the venue had a calendar to ask, so
            // this is the first moment anyone could know they don't work.
            const heldByHost = new Map<string, number>()
            for (const e of held) {
              const memberId = hostOf(e)
              if (!memberId) continue
              heldByHost.set(memberId, (heldByHost.get(memberId) ?? 0) + 1)
            }
            for (const [memberId, count] of heldByHost) {
              void sendPushToMember(
                memberId,
                NotificationTemplates.hostedEventDatesHeld(data.name, count),
              ).catch(() => {})
              notified.add(memberId)
            }
          }
        } catch (err) {
          // The course is approved either way — the rounds can still be
          // published by hand from the hosted-events queue.
          console.error('[courses/approve] Publishing waiting events failed (non-fatal):', err)
        }

        // The member who proposed this venue, if nothing above already told them.
        //
        // A host asking for a venue with no rounds yet, or one whose rounds all
        // landed on days the calendar can't take, would otherwise watch a venue
        // go live in silence — the request they made would just stop being
        // pending, with nothing to say so.
        const requestedBy = data.requested_by as string | null
        if (requestedBy && !notified.has(requestedBy)) {
          void sendPushToMember(
            requestedBy,
            NotificationTemplates.venueApproved(data.name),
          ).catch(() => {})
        }

        // Grant host access to any host who already has an event at this club —
        // e.g. the host who proposed it while creating one — so their next event
        // here isn't blocked by the venue check. Best-effort; never blocks the
        // approval.
        try {
          const { data: eventHosts } = await admin
            .from('hosted_events')
            .select('host_id')
            .eq('course_id', id)
          const hostIds = Array.from(new Set((eventHosts ?? []).map(e => e.host_id)))
          if (hostIds.length) {
            await admin
              .from('host_venues')
              .upsert(hostIds.map(host_id => ({ host_id, course_id: id })), {
                onConflict: 'host_id,course_id',
                ignoreDuplicates: true,
              })
          }
        } catch (err) {
          console.error('[courses/approve] host_venues grant failed (non-fatal):', err)
        }

        // This is the "goes live" moment for a member-requested course.
        void activeCourseIds(admin, data.id)
          .then(courseIds => postAnnouncementToCourses(admin, courseIds, {
            type: 'new_course',
            authorId: ctx.userId,
            title: `New course added: ${data.name}`,
            body: `${data.name} is now available for booking. Check it out and get your next round on the books.`,
            metadata: { course_id: data.id },
          }))
          .catch(err => console.error('[courses/approve] Announcement post failed (non-fatal):', err))

        return NextResponse.json({ course: data, publishedEvents, heldEvents })
      }

      // reject — the reason is required, not optional. A rejected course is one
      // a member proposed and we turned down; without a note the next admin
      // seeing it has no idea whether it was a duplicate, out of area, or a
      // mistake, and the host who proposed it gets no answer either.
      const rejectionReason = body.rejection_reason?.trim() ?? ''
      if (!rejectionReason) {
        return NextResponse.json({ error: 'A reason is required to reject a course.' }, { status: 400 })
      }

      const { data, error } = await admin
        .from('courses')
        .update({
          approval_status: 'rejected',
          rejection_reason: sanitiseText(rejectionReason),
          reviewed_by: ctx.userId,
        })
        .eq('id', id).select().single()
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })

      try {
        await admin.from('admin_audit_log').insert({
          admin_id: ctx.userId,
          action: 'courses.rejected',
          target_type: 'course',
          target_id: id,
          payload: { name: data?.name, reason: rejectionReason },
        })
      } catch { /* table may not exist yet */ }

      return NextResponse.json({ course: data })
    }

    // General field update
    if ('slug' in body && body.slug) {
      const slug = body.slug.trim()
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
        return NextResponse.json({ error: 'Slug must be lowercase letters, numbers, and hyphens only' }, { status: 400 })
      }
      const { data: conflict } = await admin.from('courses').select('id').eq('slug', slug).neq('id', id).limit(1)
      if (conflict?.length) {
        return NextResponse.json({ error: `The slug "${slug}" is already taken. Choose a different one.` }, { status: 409 })
      }
    }

    if ('booking_url' in body && body.booking_url?.trim()) {
      if (!isValidUrl(body.booking_url.trim())) {
        return NextResponse.json({ error: 'Website must be a valid URL (e.g. https://example.com)' }, { status: 400 })
      }
    }

    if ('map_link' in body && body.map_link?.trim()) {
      if (!isValidUrl(body.map_link.trim())) {
        return NextResponse.json({ error: 'Map link must be a valid URL (e.g. https://maps.google.com/...)' }, { status: 400 })
      }
    }

    if ('timezone' in body && body.timezone && !validateTimezone(body.timezone, 'timezone').valid) {
      return NextResponse.json({ error: 'Timezone must be a valid IANA timezone (e.g. America/Los_Angeles)' }, { status: 400 })
    }

    // logo_url is required — reject attempts to clear it, but allow omitting
    // the key entirely (no change) or replacing it with a new upload.
    if ('logo_url' in body && !body.logo_url?.trim()) {
      return NextResponse.json({ error: 'A venue logo is required' }, { status: 400 })
    }

    // payment_url is required — reject attempts to clear it, but allow omitting
    // the key entirely (no change) or replacing it with a new link.
    if ('payment_url' in body) {
      if (!body.payment_url?.trim()) {
        return NextResponse.json({ error: 'A payment link is required' }, { status: 400 })
      }
      if (!isValidUrl(body.payment_url.trim())) {
        return NextResponse.json({ error: 'Payment link must be a valid URL (e.g. https://example.com)' }, { status: 400 })
      }
    }

    // Calendar uniqueness on edit: reject if the new calendar is already used by a different course
    if ('ghl_calendar_id' in body && body.ghl_calendar_id) {
      const { data: calConflict } = await admin
        .from('courses')
        .select('id, name')
        .eq('ghl_calendar_id', body.ghl_calendar_id)
        .neq('id', id)
        .limit(1)
      if (calConflict?.length) {
        return NextResponse.json(
          { error: `This GHL calendar is already assigned to "${calConflict[0]?.name ?? 'another course'}". Each course must use a unique calendar.` },
          { status: 409 }
        )
      }
    }

    const allowed: Array<keyof Course> = [
      'name', 'slug', 'logo_url', 'city', 'state', 'country', 'address', 'phone', 'map_link',
      'access_tag', 'timezone', 'active',
      'description', 'ghl_calendar_id', 'ghl_calendar_user_id', 'cost_per_player',
      'booking_rules', 'booking_url', 'payment_url', 'required_tags', 'meeting_interval_mins',
      'meeting_duration_mins', 'min_scheduling_notice_mins', 'date_range_days',
      'pre_buffer_mins', 'post_buffer_mins', 'seats_per_class', 'max_players_per_day',
      'custom_slots_enabled', 'pinned',
    ]
    const updates: Record<string, unknown> = {}
    for (const key of allowed) {
      if (key in body) updates[key] = body[key]
    }

    // Cap on pinned venues, the same rule pinned announcements are held to.
    // Counted server-side rather than trusted from the admin page, which can be
    // looking at a stale list — two admins pinning at once would otherwise both
    // pass a client check that said there was room for one.
    if (updates.pinned === true) {
      const { data: current } = await admin
        .from('courses')
        .select('pinned')
        .eq('id', id)
        .maybeSingle()
      if (current && !current.pinned) {
        const { count } = await admin
          .from('courses')
          .select('id', { count: 'exact', head: true })
          .eq('pinned', true)
        if ((count ?? 0) >= MAX_PINNED_COURSES) {
          return NextResponse.json(
            { error: `Maximum of ${MAX_PINNED_COURSES} venues can be pinned at a time.` },
            { status: 400 }
          )
        }
      }
    }
    // Sync access_tag from required_tags whenever tags are updated
    if ('required_tags' in updates) {
      const tags = updates.required_tags as string[]
      updates.access_tag = tags[0] ?? ''
    }
    // Normalise optional text/URL fields: empty string → null
    for (const key of ['booking_url', 'address', 'phone', 'map_link', 'ghl_calendar_id'] as const) {
      if (key in updates) updates[key] = (updates[key] as string)?.trim() || null
    }
    if (!Object.keys(updates).length) return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })

    // The GHL calendar owns the round length, so pointing a course at a calendar
    // adopts that calendar's slot duration. Mirroring it here keeps the member and
    // admin screens showing the right end time without either of them calling GHL.
    if (typeof updates.ghl_calendar_id === 'string' && updates.ghl_calendar_id) {
      const rules = await getCalendarBookingRules(updates.ghl_calendar_id)
      if (rules?.slotDurationMins) updates.meeting_duration_mins = rules.slotDurationMins
    }

    const { data, error } = await admin.from('courses').update(updates).eq('id', id).select().single()
    if (error) {
      // Concurrent edit raced past the pre-checks above and hit a unique
      // constraint (slug or ghl_calendar_id) — surface the same clean 409
      // instead of a raw 500.
      if (error.code === '23505') {
        if (error.message.includes('courses_ghl_calendar_id_unique')) {
          return NextResponse.json(
            { error: 'This GHL calendar is already assigned to another course. Each course must use a unique calendar.' },
            { status: 409 }
          )
        }
        const attemptedSlug = typeof updates.slug === 'string' ? updates.slug : 'value'
        return NextResponse.json({ error: `The slug "${attemptedSlug}" is already taken. Choose a different one.` }, { status: 409 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ course: data })
  },
  { requireAdmin: true, skipGHLCheck: true }
)

// Hard-delete a course.
//
// Safety rules (checked before any mutation):
//   1. ANY booking for this course (active, past, or cancelled) blocks deletion —
//      bookings are financial/play-history records that must be preserved.
//   2. Any member with this as their home_course_id also blocks deletion —
//      reassign those members first.
//
// If both checks pass the course has no meaningful history and can be removed.
// Related content rows (announcements, conversations, member_events, focus_linkups)
// are deleted as part of the same operation since they carry no financial weight.
//
// Use Archive (approval_status = 'archived') for courses with any booking history.
export const DELETE = withAuth(
  async (req: NextRequest, ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing course id' }, { status: 400 })

    // Deleting a course removes the row outright, so the only place the "why"
    // can survive is the audit log — which makes the note the entire record of
    // this decision. Required for that reason, not as a speed bump.
    const body = await req.json().catch(() => ({})) as { reason?: string }
    const reason = body.reason?.trim() ?? ''
    if (!reason) {
      return NextResponse.json({ error: 'A reason is required to delete a course.' }, { status: 400 })
    }

    const admin = createAdminClient()

    // 1. Check ALL bookings — any status (active, past, cancelled)
    const [totalBookingsRes, activeBookingsRes, homeMembersRes] =
      await Promise.all([
        admin.from('bookings').select('id', { count: 'exact', head: true }).eq('course_id', id),
        admin.from('bookings').select('id', { count: 'exact', head: true }).eq('course_id', id).neq('status', 'cancelled'),
        admin.from('members').select('id', { count: 'exact', head: true }).eq('home_course_id', id),
      ])

    // Fail secure: if any safety check itself failed, block the delete rather
    // than treating a DB error as "no bookings/members found".
    const checkError = totalBookingsRes.error ?? activeBookingsRes.error ?? homeMembersRes.error
    if (checkError) {
      return NextResponse.json({ error: `Could not verify it's safe to delete this course: ${checkError.message}` }, { status: 500 })
    }

    const totalBookings = totalBookingsRes.count
    const activeBookings = activeBookingsRes.count
    const homeMembers = homeMembersRes.count

    const reasons: string[] = []
    if ((totalBookings ?? 0) > 0) {
      const active = activeBookings ?? 0
      const past = (totalBookings ?? 0) - active
      const parts = []
      if (active > 0) parts.push(`${active} active booking${active !== 1 ? 's' : ''}`)
      if (past > 0) parts.push(`${past} past/cancelled booking${past !== 1 ? 's' : ''}`)
      reasons.push(`Booking history: ${parts.join(', ')} — these are financial records and cannot be removed`)
    }
    if ((homeMembers ?? 0) > 0) {
      reasons.push(`${homeMembers} member${(homeMembers ?? 0) !== 1 ? 's have' : ' has'} this as their home course — reassign them first`)
    }

    if (reasons.length > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete this course:\n• ${reasons.join('\n• ')}\n\nArchive it instead to hide it from members while preserving records.`,
          reasons,
        },
        { status: 409 }
      )
    }

    // Safe to delete — clean up related content rows first, then the course.
    // Read the identifying fields before the row goes: the audit entry has to
    // stand on its own afterwards, and a bare uuid tells nobody anything.
    const { data: course } = await admin
      .from('courses')
      .select('ghl_calendar_id, name, slug, city, state, approval_status')
      .eq('id', id)
      .single()

    // Delete content records that reference this course (no financial significance)
    await Promise.all([
      admin.from('announcements').delete().eq('course_id', id),
      admin.from('conversations').delete().eq('course_id', id),
      admin.from('member_events').delete().eq('course_id', id),
      admin.from('focus_linkups').delete().eq('course_id', id),
    ])

    // Delete the course (course_memberships cascade automatically via FK)
    const { error } = await admin.from('courses').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Written after the delete succeeds, so the log never claims something that
    // didn't happen. This entry is now the only record the course ever existed.
    try {
      await admin.from('admin_audit_log').insert({
        admin_id: ctx.userId,
        action: 'courses.deleted',
        target_type: 'course',
        target_id: id,
        payload: {
          reason,
          name: course?.name,
          slug: course?.slug,
          city: course?.city,
          state: course?.state,
          approval_status: course?.approval_status,
        },
      })
    } catch { /* table may not exist yet */ }

    logger.info('Course deleted by admin', {
      action: 'admin.course.deleted',
      userId: ctx.userId,
      metadata: { course_id: id, name: course?.name },
    })

    // Clean up GHL calendar (best-effort, non-fatal)
    if (course?.ghl_calendar_id) await deleteGHLCalendar(course.ghl_calendar_id)

    return NextResponse.json({ ok: true })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
