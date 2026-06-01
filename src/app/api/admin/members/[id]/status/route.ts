export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import type { AuthContext } from '@/lib/auth/types'

type StatusAction = 'active' | 'suspended' | 'cancelled' | 'waitlist' | 'pending'

export const PATCH = withAuth(
  async (req: NextRequest, ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const memberId = routeCtx!.params.id
    const body = await req.json() as { status: StatusAction }
    const { status } = body

    const allowed: StatusAction[] = ['active', 'suspended', 'cancelled', 'waitlist', 'pending']
    if (!status || !allowed.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    if (memberId === ctx.userId && status === 'suspended') {
      return NextResponse.json({ error: 'You cannot suspend your own account.' }, { status: 403 })
    }

    const admin = createAdminClient()

    const { error } = await admin
      .from('members')
      .update({ membership_status: status })
      .eq('id', memberId)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // When activating, also activate the member's home course membership.
    if (status === 'active') {
      const { data: member } = await admin
        .from('members')
        .select('home_course_id')
        .eq('id', memberId)
        .single()

      if (member?.home_course_id) {
        await admin
          .from('course_memberships')
          .update({ status: 'active' })
          .eq('member_id', memberId)
          .eq('course_id', member.home_course_id)
      }
    }

    try {
      await admin.from('admin_audit_log').insert({
        admin_id: ctx.userId,
        action: `members.status.${status}`,
        target_type: 'member',
        target_id: memberId,
        payload: { status },
      })
    } catch { /* table may not exist yet */ }

    return NextResponse.json({ ok: true })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
