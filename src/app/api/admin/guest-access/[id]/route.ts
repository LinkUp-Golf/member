import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { logger } from '@/lib/logger'
import type { AuthContext } from '@/lib/auth/types'

type GuestAction = 'revoke' | 'extend'

export const PATCH = withAuth(
  async (req: NextRequest, ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing guest access id' }, { status: 400 })

    const body = await req.json() as { action: GuestAction; extends_until?: string }
    const { action, extends_until } = body

    if (!action) return NextResponse.json({ error: 'Missing action' }, { status: 400 })

    const admin = createAdminClient()

    const { data: request, error: fetchError } = await admin
      .from('guest_access_requests')
      .select('requesting_member_id, target_course_id, visit_until')
      .eq('id', id)
      .single()

    if (fetchError || !request) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 })
    }

    if (action === 'revoke') {
      const { error } = await admin
        .from('guest_access_requests')
        .update({ status: 'revoked' })
        .eq('id', id)

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })

      await admin
        .from('course_memberships')
        .update({ status: 'expired' })
        .eq('member_id', (request as any).requesting_member_id)
        .eq('course_id', (request as any).target_course_id)
        .eq('access_type', 'guest')

      logger.warn('Admin revoked guest access', {
        action: 'guest_access.revoked',
        userId: ctx.userId,
        metadata: { request_id: id, member_id: (request as any).requesting_member_id },
      })

      try {
        await admin.from('admin_audit_log').insert({
          admin_id: ctx.userId,
          action: 'guest_access.revoked',
          target_type: 'guest_access_request',
          target_id: id,
          payload: {
            member_id: (request as any).requesting_member_id,
            course_id: (request as any).target_course_id,
          },
        })
      } catch { /* table may not exist yet */ }

    } else if (action === 'extend') {
      if (!extends_until) {
        return NextResponse.json({ error: 'Missing extends_until date' }, { status: 400 })
      }

      const { error } = await admin
        .from('guest_access_requests')
        .update({ visit_until: extends_until })
        .eq('id', id)

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })

      await admin
        .from('course_memberships')
        .update({ valid_until: extends_until })
        .eq('member_id', (request as any).requesting_member_id)
        .eq('course_id', (request as any).target_course_id)
        .eq('access_type', 'guest')

      logger.info('Admin extended guest access', {
        action: 'guest_access.extended',
        userId: ctx.userId,
        metadata: { request_id: id, extends_until },
      })

      try {
        await admin.from('admin_audit_log').insert({
          admin_id: ctx.userId,
          action: 'guest_access.extended',
          target_type: 'guest_access_request',
          target_id: id,
          payload: { extends_until, previous_until: (request as any).visit_until },
        })
      } catch { /* table may not exist yet */ }

    } else {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
