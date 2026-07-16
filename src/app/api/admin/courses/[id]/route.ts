export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { createGHLCalendar, deleteGHLCalendar, getCalendarBookingRules } from '@/lib/ghl/client'
import { validateTimezone } from '@/lib/validation'
import { activeCourseIds, postAnnouncementToCourses } from '@/lib/announcements/fan-out'
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

        return NextResponse.json({ course: data })
      }

      // reject
      const { data, error } = await admin
        .from('courses')
        .update({ approval_status: 'rejected', rejection_reason: body.rejection_reason ?? null, reviewed_by: ctx.userId })
        .eq('id', id).select().single()
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
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
      'custom_slots_enabled',
    ]
    const updates: Record<string, unknown> = {}
    for (const key of allowed) {
      if (key in body) updates[key] = body[key]
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
  async (_req: NextRequest, _ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing course id' }, { status: 400 })

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

    // Safe to delete — clean up related content rows first, then the course
    const { data: course } = await admin.from('courses').select('ghl_calendar_id').eq('id', id).single()

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

    // Clean up GHL calendar (best-effort, non-fatal)
    if (course?.ghl_calendar_id) await deleteGHLCalendar(course.ghl_calendar_id)

    return NextResponse.json({ ok: true })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
