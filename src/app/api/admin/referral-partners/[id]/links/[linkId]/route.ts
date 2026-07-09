export const dynamic = 'force-dynamic'

// DELETE /api/admin/referral-partners/[id]/links/[linkId]
// Removes a single link. Referral attribution lives entirely in our DB, so this
// leaves the GHL contact (a lead) untouched.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import type { AuthContext } from '@/lib/auth/types'

export const DELETE = withAuth(
  async (_req: NextRequest, _ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    const linkId = routeCtx?.params?.['linkId']
    if (!id || !linkId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const admin = createAdminClient()

    const { error, count } = await admin
      .from('referral_partner_links')
      .delete({ count: 'exact' })
      .eq('id', linkId)
      .eq('referral_partner_id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!count) return NextResponse.json({ error: 'Link not found' }, { status: 404 })

    return NextResponse.json({ ok: true })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
