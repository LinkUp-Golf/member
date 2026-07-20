export const dynamic = 'force-dynamic'

// PATCH /api/admin/referral-submissions/[id] — import or reject a partner's
// submitted referral list. Importing attributes each entry to that partner
// (creating a CRM lead for non-members); entries already claimed by another
// partner are skipped with a reason rather than moved.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { linkTargetsToPartner } from '@/lib/referral-links'
import { sendPushToMember, NotificationTemplates } from '@/lib/push'
import { logger } from '@/lib/logger'
import type { AuthContext } from '@/lib/auth/types'

interface PatchBody {
  action?: 'import' | 'reject'
  rejection_reason?: string
}

export const PATCH = withAuth(
  async (req: NextRequest, ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing submission id' }, { status: 400 })

    const body = await req.json().catch(() => ({})) as PatchBody
    if (body.action !== 'import' && body.action !== 'reject') {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    const admin = createAdminClient()

    const { data: submission, error: fetchError } = await admin
      .from('referral_partner_submissions')
      .select('id, referral_partner_id, status, entries:referral_partner_submission_entries(id, email, name)')
      .eq('id', id)
      .single()

    if (fetchError || !submission) {
      return NextResponse.json({ error: 'Submission not found' }, { status: 404 })
    }
    if (submission.status !== 'pending') {
      return NextResponse.json({ error: 'This list has already been reviewed.' }, { status: 409 })
    }

    const { data: partner } = await admin
      .from('referral_partners')
      .select('id, member_id, percentage, ends_at')
      .eq('id', submission.referral_partner_id)
      .single()

    const reviewedAt = new Date().toISOString()

    // ---- Reject ------------------------------------------------
    if (body.action === 'reject') {
      const reason = body.rejection_reason?.trim() ?? ''
      if (!reason) {
        return NextResponse.json({ error: 'A rejection reason is required' }, { status: 400 })
      }

      const { error } = await admin
        .from('referral_partner_submissions')
        .update({
          status: 'rejected',
          rejection_reason: reason,
          reviewed_by: ctx.userId,
          reviewed_at: reviewedAt,
          updated_at: reviewedAt,
        })
        .eq('id', id)
        // Only from pending, so two admins reviewing at once can't both apply
        // an outcome.
        .eq('status', 'pending')

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })

      if (partner?.member_id) {
        void sendPushToMember(
          partner.member_id,
          NotificationTemplates.referralListRejected(reason)
        ).catch(() => {})
      }

      logger.info('Referral submission rejected', {
        action: 'referral_partner.submission.rejected',
        userId: ctx.userId,
        metadata: { submission_id: id, partner_id: submission.referral_partner_id },
      })

      return NextResponse.json({ ok: true, status: 'rejected' })
    }

    // ---- Import ------------------------------------------------
    const entries = (submission.entries ?? []) as Array<{ id: string; email: string; name: string | null }>

    // repoint: false — a partner listing someone another partner already
    // referred must not take them over. Those come back skipped.
    const outcomes = await linkTargetsToPartner(
      admin,
      submission.referral_partner_id,
      entries.map(e => ({ email: e.email, name: e.name })),
      { repoint: false }
    )

    const outcomeByEmail = new Map(outcomes.map(o => [o.email.toLowerCase(), o]))
    let importedCount = 0

    for (const entry of entries) {
      const outcome = outcomeByEmail.get(entry.email.toLowerCase())

      // Record the per-entry result so the partner can see exactly what
      // happened to each name they submitted. 'already' counts as imported: the
      // person IS now referred by this partner — and treating it so makes a
      // retry after a partial failure (links created, status update failed)
      // report the true count instead of 0.
      const update = outcome?.status === 'linked'
        ? { status: 'imported', link_id: outcome.linkId, skip_reason: null }
        : outcome?.status === 'already'
        ? { status: 'imported', link_id: outcome.linkId, skip_reason: null }
        : { status: 'skipped', link_id: null, skip_reason: outcome?.reason ?? 'Could not import' }

      if (update.status === 'imported') importedCount++
      await admin.from('referral_partner_submission_entries').update(update).eq('id', entry.id)
    }

    const { error: statusError } = await admin
      .from('referral_partner_submissions')
      .update({
        status: 'imported',
        imported_count: importedCount,
        // The rate these referrals were taken on. Commission is still derived
        // from the partner's current percentage; this is the audit record of
        // what was configured on the day, and makes an import under an expired
        // rate traceable after the fact.
        applied_percentage: partner?.percentage ?? null,
        reviewed_by: ctx.userId,
        reviewed_at: reviewedAt,
        updated_at: reviewedAt,
      })
      .eq('id', id)
      .eq('status', 'pending')

    if (statusError) return NextResponse.json({ error: statusError.message }, { status: 500 })

    if (partner?.member_id) {
      void sendPushToMember(
        partner.member_id,
        NotificationTemplates.referralListImported(importedCount, entries.length)
      ).catch(() => {})
    }

    logger.info('Referral submission imported', {
      action: 'referral_partner.submission.imported',
      userId: ctx.userId,
      metadata: {
        submission_id: id,
        partner_id: submission.referral_partner_id,
        imported: importedCount,
        total: entries.length,
      },
    })

    return NextResponse.json({
      ok: true,
      status: 'imported',
      imported: importedCount,
      total: entries.length,
      skipped: outcomes
        .filter((o): o is Extract<typeof o, { status: 'skipped' }> => o.status === 'skipped')
        .map(o => ({ email: o.email, reason: o.reason })),
    })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
