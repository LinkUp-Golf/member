import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { logger } from '@/lib/logger'
import type { AuthContext } from '@/lib/auth/types'

type ModerationAction = 'warn' | 'suspend' | 'unsuspend'

export const POST = withAuth(
  async (req: NextRequest, ctx: AuthContext) => {
    const body = await req.json() as {
      action: ModerationAction
      member_id: string
      item_id?: string
      item_type?: string
    }

    const { action, member_id, item_id, item_type } = body

    if (!action || !member_id) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const admin = createAdminClient()

    if (action === 'warn') {
      const { data: member } = await admin
        .from('members')
        .select('warning_count')
        .eq('id', member_id)
        .single()

      const newCount = ((member as any)?.warning_count ?? 0) + 1

      const { error } = await admin
        .from('members')
        .update({ warning_count: newCount })
        .eq('id', member_id)

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })

      logger.info('Admin issued warning', {
        action: 'moderation.warn',
        userId: ctx.userId,
        metadata: { member_id, item_id, item_type, warning_count: newCount },
      })

      try {
        await admin.from('admin_audit_log').insert({
          admin_id: ctx.userId,
          action: 'moderation.warn',
          target_type: item_type ?? 'member',
          target_id: item_id ?? member_id,
          payload: { member_id, warning_count: newCount },
        })
      } catch { /* table may not exist yet */ }

    } else if (action === 'suspend') {
      const { error } = await admin
        .from('members')
        .update({ membership_status: 'suspended' })
        .eq('id', member_id)

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })

      logger.warn('Admin suspended member', {
        action: 'moderation.suspend',
        userId: ctx.userId,
        metadata: { member_id, item_id, item_type },
      })

      try {
        await admin.from('admin_audit_log').insert({
          admin_id: ctx.userId,
          action: 'moderation.suspend',
          target_type: item_type ?? 'member',
          target_id: item_id ?? member_id,
          payload: { member_id },
        })
      } catch { /* table may not exist yet */ }

    } else if (action === 'unsuspend') {
      const { error } = await admin
        .from('members')
        .update({ membership_status: 'active' })
        .eq('id', member_id)

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })

      logger.info('Admin reinstated member', {
        action: 'moderation.unsuspend',
        userId: ctx.userId,
        metadata: { member_id },
      })

      try {
        await admin.from('admin_audit_log').insert({
          admin_id: ctx.userId,
          action: 'moderation.unsuspend',
          target_type: 'member',
          target_id: member_id,
          payload: { member_id },
        })
      } catch { /* table may not exist yet */ }

    } else {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
