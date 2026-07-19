export const dynamic = 'force-dynamic'

// PATCH /api/admin/referral-partner-applications/[id] — approve or reject.
// Approving creates the member's referral_partners row, which is what grants
// the referral-partner role. Either outcome notifies the applicant.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { validateReferralPartnerPayload } from '@/lib/validation'
import { DEFAULT_REFERRAL_PERCENTAGE } from '@/lib/constants'
import { sendPushToMember, NotificationTemplates } from '@/lib/push'
import { logger } from '@/lib/logger'
import type { AuthContext } from '@/lib/auth/types'

function toSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

interface PatchBody {
  action?: 'approve' | 'reject'
  // Approval terms — the admin sets the partner's rate when granting the role.
  code?: string
  percentage?: number
  ends_at?: string | null
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
      .from('referral_partner_applications')
      .select('id, member_id, status, member:members(first_name, last_name)')
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

      const { error } = await admin
        .from('referral_partner_applications')
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

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })

      void sendPushToMember(
        application.member_id,
        NotificationTemplates.referralPartnerRejected(reason)
      ).catch(() => {})

      logger.info('Referral partner application rejected', {
        action: 'referral_partner.application.rejected',
        userId: ctx.userId,
        metadata: { application_id: id, member_id: application.member_id },
      })

      return NextResponse.json({ ok: true, status: 'rejected' })
    }

    // ---- Approve -----------------------------------------------
    const member = Array.isArray(application.member) ? application.member[0] : application.member
    const memberName = `${member?.first_name ?? ''} ${member?.last_name ?? ''}`.trim() || 'Referral Partner'

    const percentage = body.percentage ?? DEFAULT_REFERRAL_PERCENTAGE
    const code = body.code?.trim() || toSlug(memberName)
    const endsAt = body.ends_at?.trim() || null

    const { valid, errors } = validateReferralPartnerPayload(
      { name: memberName, code, percentage, ends_at: endsAt }
    )
    if (!valid) return NextResponse.json({ error: errors[0] }, { status: 400 })

    // Code uniqueness pre-check; the unique constraint is the race-safe backstop.
    const { data: codeConflict } = await admin
      .from('referral_partners').select('id').eq('code', code).limit(1)
    if (codeConflict?.length) {
      return NextResponse.json(
        { error: `The code "${code}" is already taken. Choose a different one.` },
        { status: 409 }
      )
    }

    const { data: partner, error: partnerError } = await admin
      .from('referral_partners')
      .insert({
        name: memberName,
        code,
        percentage,
        ends_at: endsAt,
        member_id: application.member_id,
        created_by: ctx.userId,
      })
      .select()
      .single()

    if (partnerError) {
      if (partnerError.code === '23505') {
        return NextResponse.json(
          { error: 'That code is already taken, or this member is already a referral partner.' },
          { status: 409 }
        )
      }
      return NextResponse.json({ error: partnerError.message }, { status: 500 })
    }

    const { error: statusError } = await admin
      .from('referral_partner_applications')
      .update({
        status: 'approved',
        partner_id: partner.id,
        reviewed_by: ctx.userId,
        reviewed_at: reviewedAt,
        updated_at: reviewedAt,
      })
      .eq('id', id)
      .eq('status', 'pending')

    if (statusError) {
      // The role was granted but the application didn't close — roll the
      // partner row back so the queue and the role can't disagree.
      await admin.from('referral_partners').delete().eq('id', partner.id)
      return NextResponse.json({ error: statusError.message }, { status: 500 })
    }

    void sendPushToMember(
      application.member_id,
      NotificationTemplates.referralPartnerApproved(percentage)
    ).catch(() => {})

    logger.info('Referral partner application approved', {
      action: 'referral_partner.application.approved',
      userId: ctx.userId,
      metadata: { application_id: id, member_id: application.member_id, partner_id: partner.id },
    })

    return NextResponse.json({ ok: true, status: 'approved', partner })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
