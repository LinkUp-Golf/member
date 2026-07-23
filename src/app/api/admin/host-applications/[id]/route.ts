export const dynamic = 'force-dynamic'

// PATCH /api/admin/host-applications/[id] — approve or reject.
// Approving creates the member's hosts row, which is what grants the host role.
// Either outcome notifies the applicant.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { validateString } from '@/lib/validation'
import { sendPushToMember, NotificationTemplates } from '@/lib/push'
import { logger } from '@/lib/logger'
import type { AuthContext } from '@/lib/auth/types'

interface PatchBody {
  action?: 'approve' | 'reject'
  // Approval terms — the admin can override the host's display name.
  name?: string
  // Venues to grant the host. Defaults to what the applicant requested.
  course_ids?: string[]
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
      .select('id, member_id, status, name, requested_course_ids, member:members!host_applications_member_id_fkey(first_name, last_name)')
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

    const { data: host, error: hostError } = await admin
      .from('hosts')
      .insert({
        member_id: application.member_id,
        name: hostName,
        created_by: ctx.userId,
      })
      .select()
      .single()

    if (hostError) {
      if (hostError.code === '23505') {
        return NextResponse.json(
          { error: 'This member is already a host.' },
          { status: 409 }
        )
      }
      return NextResponse.json({ error: hostError.message }, { status: 500 })
    }

    // Grant the host their venues: the admin's override if given, otherwise the
    // courses the applicant requested. Filter to real, active courses so a stale
    // id can't produce a dangling host_venues row.
    const requestedVenueIds = Array.from(new Set(
      Array.isArray(body.course_ids) && body.course_ids.length
        ? body.course_ids
        : (application.requested_course_ids ?? [])
    ))
    if (requestedVenueIds.length) {
      const { data: activeCourses } = await admin
        .from('courses')
        .select('id')
        .in('id', requestedVenueIds)
        .eq('active', true)
        .eq('approval_status', 'active')
      const venueRows = (activeCourses ?? []).map(c => ({ host_id: host.id, course_id: c.id }))
      if (venueRows.length) {
        const { error: venuesError } = await admin.from('host_venues').insert(venueRows)
        if (venuesError) {
          // Don't leave a host with no venues when the applicant asked for some —
          // roll the host back and let the admin retry.
          await admin.from('hosts').delete().eq('id', host.id)
          return NextResponse.json({ error: venuesError.message }, { status: 500 })
        }
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
      await admin.from('hosts').delete().eq('id', host.id)
      if (statusError) return NextResponse.json({ error: statusError.message }, { status: 500 })
      return NextResponse.json({ error: 'This application has already been reviewed.' }, { status: 409 })
    }

    void sendPushToMember(
      application.member_id,
      NotificationTemplates.hostApplicationApproved()
    ).catch(() => {})

    logger.info('Host application approved', {
      action: 'host.application.approved',
      userId: ctx.userId,
      metadata: { application_id: id, member_id: application.member_id, host_id: host.id },
    })

    return NextResponse.json({ ok: true, status: 'approved', host })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
