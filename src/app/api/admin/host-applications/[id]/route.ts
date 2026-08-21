export const dynamic = 'force-dynamic'

// PATCH /api/admin/host-applications/[id] — approve or reject.
// Approving creates the member's hosts row, which is what grants the host role.
// Either outcome notifies the applicant.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { validateString, validateUUID } from '@/lib/validation'
import { sendPushToMember, NotificationTemplates } from '@/lib/push'
import { addTagToContact } from '@/lib/ghl/client'
import { HOST_ROLE_TAG } from '@/lib/ghl/tags'
import { logger } from '@/lib/logger'
import type { AuthContext } from '@/lib/auth/types'
import type { Host, HostApplicationEvent } from '@/types'

interface PatchBody {
  action?: 'approve' | 'reject'
  // Approval terms — the admin can override the host's display name.
  name?: string
  // Venues to grant the host. Defaults to what the applicant requested.
  course_ids?: string[]
  /**
   * Which proposed rounds to turn into live events. Defaults to all of them at
   * granted venues; pass a subset to drop individual rounds.
   */
  event_ids?: string[]
  rejection_reason?: string
}

export const PATCH = withAuth(
  async (req: NextRequest, ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing application id' }, { status: 400 })

    const body = await req.json().catch(() => ({})) as PatchBody
    if (body.action !== 'approve' && body.action !== 'reject') {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    const admin = createAdminClient()

    const { data: application, error: fetchError } = await admin
      .from('host_applications')
      .select('id, member_id, status, name, requested_course_ids, events:host_application_events(*), member:members!host_applications_member_id_fkey(first_name, last_name)')
      .eq('id', id)
      .single()

    if (fetchError || !application) {
      return NextResponse.json({ error: 'Application not found' }, { status: 404 })
    }
    if (application.status !== 'pending') {
      return NextResponse.json({ error: 'This application has already been reviewed.' }, { status: 409 })
    }

    const reviewedAt = new Date().toISOString()

    // ---- Reject ------------------------------------------------
    if (body.action === 'reject') {
      const reason = body.rejection_reason?.trim() ?? ''
      if (!reason) {
        return NextResponse.json({ error: 'A rejection reason is required' }, { status: 400 })
      }

      const { data: rejected, error } = await admin
        .from('host_applications')
        .update({
          status: 'rejected',
          rejection_reason: reason,
          reviewed_by: ctx.userId,
          reviewed_at: reviewedAt,
          updated_at: reviewedAt,
        })
        .eq('id', id)
        // Only transition from pending, so two admins reviewing at once can't
        // both apply an outcome.
        .eq('status', 'pending')
        .select('id')

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      // 0 rows means another admin already reviewed it in the race window — a
      // matched-nothing update is not an error, so check explicitly.
      if (!rejected || rejected.length === 0) {
        return NextResponse.json({ error: 'This application has already been reviewed.' }, { status: 409 })
      }

      void sendPushToMember(
        application.member_id,
        NotificationTemplates.hostApplicationRejected(reason)
      ).catch(() => {})

      logger.info('Host application rejected', {
        action: 'host.application.rejected',
        userId: ctx.userId,
        metadata: { application_id: id, member_id: application.member_id },
      })

      return NextResponse.json({ ok: true, status: 'rejected' })
    }

    // ---- Approve -----------------------------------------------
    const member = Array.isArray(application.member) ? application.member[0] : application.member
    const memberName = `${member?.first_name ?? ''} ${member?.last_name ?? ''}`.trim() || 'Host'

    // Host name: the admin's override, else the name the applicant proposed,
    // else the member's own name.
    const hostName = body.name?.trim() || application.name?.trim() || memberName

    const nameCheck = validateString(hostName, 'Host name', { min: 2, max: 120 })
    if (!nameCheck.valid) return NextResponse.json({ error: nameCheck.errors[0] }, { status: 400 })

    // The member may already own a hosts row created by the GHL host tag
    // (ensureHostRow runs on every login). That used to make the insert below
    // fail with hosts_member_unique on every retry, so the application could
    // never leave `pending` and sat in the queue forever — the only exit was a
    // false rejection. Adopt that row instead: this review is the thing that was
    // missing from it, so it takes the reviewed name, provenance and venues.
    const { data: existingHost } = await admin
      .from('hosts')
      .select('*')
      .eq('member_id', application.member_id)
      .maybeSingle()

    let host: Host
    // The pre-existing row's values, captured before this request overwrites them,
    // so the rollback path can restore rather than delete a role it didn't grant.
    const priorHost = existingHost
      ? {
          name: existingHost.name as string,
          status: existingHost.status as string,
          source: existingHost.source as string,
          venues_unrestricted: existingHost.venues_unrestricted as boolean,
        }
      : null
    const adopted = !!existingHost

    if (existingHost) {
      const { data: updatedHost, error: adoptError } = await admin
        .from('hosts')
        .update({
          name: hostName,
          status: 'active',
          source: 'application',
          // The grant below is now the authority on where they may host, so drop
          // any blanket access the unreviewed row was carrying.
          venues_unrestricted: false,
          updated_at: reviewedAt,
        })
        .eq('id', existingHost.id)
        .select()
        .single()

      if (adoptError || !updatedHost) {
        return NextResponse.json(
          { error: adoptError?.message ?? 'Could not update the existing host.' },
          { status: 500 }
        )
      }
      host = updatedHost as Host
    } else {
      const { data: created, error: hostError } = await admin
        .from('hosts')
        .insert({
          member_id: application.member_id,
          name: hostName,
          created_by: ctx.userId,
          source: 'application',
        })
        .select()
        .single()

      if (hostError || !created) {
        return NextResponse.json(
          { error: hostError?.message ?? 'Could not create the host.' },
          { status: 500 }
        )
      }
      host = created as Host
    }

    /**
     * Undo whatever the host row was, on any later failure. An adopted row
     * existed before this request, so deleting it would revoke a role the review
     * didn't grant — restore its previous values instead.
     */
    const rollbackHost = async () => {
      if (!priorHost) {
        await admin.from('hosts').delete().eq('id', host.id)
        return
      }
      await admin.from('hosts').update(priorHost).eq('id', host.id)
    }

    // Grant the host their venues: the admin's override if given, otherwise the
    // courses the applicant requested. Filter to real courses so a stale id can't
    // produce a dangling host_venues row — but keep `pending` ones, because a club
    // the applicant proposed is a pending course and is precisely what they applied
    // to host at. Must stay in step with the same filter in POST /api/host/application.
    const requestedVenueIds = Array.from(new Set(
      Array.isArray(body.course_ids) && body.course_ids.length
        ? body.course_ids
        : (application.requested_course_ids ?? [])
    ))

    // An override arrives straight off the wire, so it gets the UUID check the
    // applicant's own ids already went through. Without this a malformed id makes
    // Postgres reject the whole `.in()` (22P02), which used to surface as an empty
    // venue set — i.e. as an unrestricted host.
    if (requestedVenueIds.some(vid => !validateUUID(vid, 'Venue').valid)) {
      await rollbackHost()
      return NextResponse.json({ error: 'One of the selected venues is invalid' }, { status: 400 })
    }

    // The venues the approval actually granted. Proposed rounds are only created
    // at these — a round at a venue the admin dropped must not become an event.
    let grantedVenueIds: string[] = []

    if (requestedVenueIds.length) {
      const { data: grantableCourses, error: coursesError } = await admin
        .from('courses')
        .select('id')
        .in('id', requestedVenueIds)
        .eq('active', true)
        .in('approval_status', ['active', 'pending'])

      const venueRows = (grantableCourses ?? []).map(c => ({ host_id: host.id, course_id: c.id }))
      grantedVenueIds = venueRows.map(v => v.course_id)

      // Fail closed. This grant is the authority on where the host may operate,
      // so producing no rows must not be treated as success — before
      // venues_unrestricted became explicit, an empty grant read as access to
      // every course. Roll back and say why instead.
      if (coursesError || venueRows.length === 0) {
        await rollbackHost()
        return NextResponse.json(
          {
            error: coursesError
              ? coursesError.message
              : 'None of the requested venues still exist. Set the venues up before approving.',
          },
          { status: coursesError ? 500 : 409 }
        )
      }

      // An adopted row may already carry venues from the unreviewed path. This
      // grant replaces them, so keep the old set for the rollback path.
      let previousVenueIds: string[] = []
      if (adopted) {
        const { data: priorVenues } = await admin
          .from('host_venues')
          .select('course_id')
          .eq('host_id', host.id)
        previousVenueIds = (priorVenues ?? []).map(v => v.course_id)
        await admin.from('host_venues').delete().eq('host_id', host.id)
      }

      const { error: venuesError } = await admin.from('host_venues').insert(venueRows)
      if (venuesError) {
        // Don't leave a host with no venues when the applicant asked for some —
        // roll the host back and let the admin retry.
        if (previousVenueIds.length) {
          await admin.from('host_venues').insert(
            previousVenueIds.map(course_id => ({ host_id: host.id, course_id }))
          )
        }
        await rollbackHost()
        return NextResponse.json({ error: venuesError.message }, { status: 500 })
      }
    }

    const { data: approved, error: statusError } = await admin
      .from('host_applications')
      .update({
        status: 'approved',
        host_id: host.id,
        reviewed_by: ctx.userId,
        reviewed_at: reviewedAt,
        updated_at: reviewedAt,
      })
      .eq('id', id)
      .eq('status', 'pending')
      .select('id')

    // Either a DB error, or another admin already moved it out of pending
    // (0 rows). In both cases the just-created host row would be orphaned, so
    // roll it back — the queue and the role must not disagree. host_venues rows
    // cascade-delete with the host.
    if (statusError || !approved || approved.length === 0) {
      await rollbackHost()
      if (statusError) return NextResponse.json({ error: statusError.message }, { status: 500 })
      return NextResponse.json({ error: 'This application has already been reviewed.' }, { status: 409 })
    }

    // ---- Turn the proposed rounds into real events -------------
    //
    // Step 3 of the model the member was shown when applying ("we put those events
    // on the LinkUp calendar") happens here. Only rounds at venues the approval
    // actually granted, and only ones the admin didn't drop. Created `upcoming`,
    // exactly as POST /api/host/events would — hosts publish without a second
    // approval gate, so there is nothing further to wait for.
    //
    // Non-fatal on failure: the role and venues are already granted and the
    // application is approved. A round that didn't make it stays on the
    // application with a null hosted_event_id, and the host can create it from
    // their own event form.
    const proposedRounds = (application.events ?? []) as HostApplicationEvent[]
    const keepIds = Array.isArray(body.event_ids) ? new Set(body.event_ids.map(String)) : null

    const roundsToCreate = proposedRounds.filter(r =>
      !r.hosted_event_id &&
      grantedVenueIds.includes(r.course_id) &&
      (keepIds === null || keepIds.has(r.id)) &&
      // A date that has passed while the application sat in the queue can't become
      // an upcoming event.
      r.event_date >= new Date().toISOString().slice(0, 10)
    )

    let createdEvents = 0
    for (const round of roundsToCreate) {
      const { data: created, error: eventError } = await admin
        .from('hosted_events')
        .insert({
          host_id: host.id,
          course_id: round.course_id,
          event_date: round.event_date,
          tee_time: round.tee_time,
          total_spots: round.total_spots,
          member_guest_rate: round.member_guest_rate,
          dinner: round.dinner,
          // Approving the application grants the role, not the listing. These
          // rounds still need a GHL calendar before a member can book one, so
          // they queue up behind the same gate as anything a host creates.
          status: 'pending_approval',
        })
        .select('id')
        .single()

      if (eventError || !created) {
        logger.warn('Could not create event from approved application round', {
          action: 'host.application.round_create_failed',
          userId: ctx.userId,
          metadata: { application_id: id, round_id: round.id, error: eventError?.message },
        })
        continue
      }

      createdEvents += 1
      // Link back so a retry can't create the same round twice.
      await admin
        .from('host_application_events')
        .update({ hosted_event_id: created.id })
        .eq('id', round.id)
    }

    // Carry the role into GHL. The login gate and the nightly reconcile both work
    // off access tags, so an approved host who later loses their golf-membership
    // tag was being refused at login and deactivated by the sync — while owning a
    // live hosts row and published events. HOST_ROLE_TAG is itself a login tag, so
    // writing it here is what makes the role survive a membership change. Hosts
    // provisioned from the tag already had this; approved ones did not.
    const { data: approvedMember } = await admin
      .from('members')
      .select('ghl_contact_id, ghl_tags')
      .eq('id', application.member_id)
      .maybeSingle()

    if (approvedMember?.ghl_contact_id) {
      const tagged = await addTagToContact(approvedMember.ghl_contact_id, HOST_ROLE_TAG)
      if (tagged) {
        const currentTags: string[] = approvedMember.ghl_tags ?? []
        if (!currentTags.includes(HOST_ROLE_TAG)) {
          await admin
            .from('members')
            .update({ ghl_tags: [...currentTags, HOST_ROLE_TAG] })
            .eq('id', application.member_id)
        }
      } else {
        // Non-fatal: the role is the hosts row, not the tag. Log it so the gap is
        // visible rather than silently costing them access later.
        logger.warn('Host approved but GHL role tag not applied', {
          action: 'host.application.tag_failed',
          userId: ctx.userId,
          metadata: { member_id: application.member_id, host_id: host.id },
        })
      }
    }

    void sendPushToMember(
      application.member_id,
      NotificationTemplates.hostApplicationApproved()
    ).catch(() => {})

    logger.info('Host application approved', {
      action: 'host.application.approved',
      userId: ctx.userId,
      metadata: {
        application_id: id,
        member_id: application.member_id,
        host_id: host.id,
        adopted_existing_host: adopted,
        events_created: createdEvents,
        rounds_proposed: proposedRounds.length,
      },
    })

    return NextResponse.json({
      ok: true,
      status: 'approved',
      host,
      events_created: createdEvents,
    })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
