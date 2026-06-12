export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import type { AuthContext } from '@/lib/auth/types'

// PATCH /api/admin/focus-linkups
// Body: { id: string; status: 'approved' | 'declined' }
// Reviews a custom group subscription request.
export const PATCH = withAuth(
  async (req: NextRequest, ctx: AuthContext) => {
    if (!ctx.isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json() as { id?: string; status?: string }
    const { id, status } = body

    if (!id || (status !== 'approved' && status !== 'declined')) {
      return NextResponse.json({ error: 'id and status (approved | declined) are required' }, { status: 400 })
    }

    const admin = createAdminClient()
    const { error } = await admin
      .from('focus_linkup_subscriptions')
      .update({ status, reviewed_at: new Date().toISOString(), reviewed_by: ctx.userId })
      .eq('id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ success: true })
  }
)
