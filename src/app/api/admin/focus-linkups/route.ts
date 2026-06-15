export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { validateUUID, validateString } from '@/lib/validation'
import type { AuthContext } from '@/lib/auth/types'

const CUSTOM_LABEL_MAX = 100

// PATCH /api/admin/focus-linkups
// Body: { id: string; status?: 'pending' | 'approved' | 'declined'; custom_label?: string }
// Moderates a custom group subscription request: change its review status
// and/or rename its custom label. At least one of status/custom_label required.
export const PATCH = withAuth(
  async (req: NextRequest, ctx: AuthContext) => {
    const body = await req.json() as { id?: string; status?: string; custom_label?: string }
    const { id, status, custom_label } = body

    const idCheck = validateUUID(id, 'id')
    if (!idCheck.valid) {
      return NextResponse.json({ error: idCheck.errors[0] }, { status: 400 })
    }

    if (status !== undefined && status !== 'pending' && status !== 'approved' && status !== 'declined') {
      return NextResponse.json({ error: 'status must be pending | approved | declined' }, { status: 400 })
    }

    if (custom_label !== undefined) {
      const labelCheck = validateString(custom_label, 'custom_label', { min: 1, max: CUSTOM_LABEL_MAX })
      if (!labelCheck.valid) {
        return NextResponse.json({ error: labelCheck.errors[0] }, { status: 400 })
      }
    }

    if (status === undefined && custom_label === undefined) {
      return NextResponse.json({ error: 'status or custom_label is required' }, { status: 400 })
    }

    const update: Record<string, unknown> = {}
    if (status !== undefined) {
      update.status = status
      update.reviewed_at = new Date().toISOString()
      update.reviewed_by = ctx.userId
    }
    if (custom_label !== undefined) {
      update.custom_label = custom_label.trim()
    }

    const admin = createAdminClient()
    const { error } = await admin
      .from('focus_linkup_subscriptions')
      .update(update)
      .eq('id', id)

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'That member already has a group with that name' }, { status: 409 })
      }
      return NextResponse.json({ error: 'Failed to update custom group' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  },
  { requireAdmin: true, skipGHLCheck: true }
)

// DELETE /api/admin/focus-linkups
// Body: { id: string }
// Removes a custom group subscription request entirely.
export const DELETE = withAuth(
  async (req: NextRequest) => {
    const { id } = await req.json() as { id?: string }

    const idCheck = validateUUID(id, 'id')
    if (!idCheck.valid) {
      return NextResponse.json({ error: idCheck.errors[0] }, { status: 400 })
    }

    const admin = createAdminClient()
    const { error } = await admin
      .from('focus_linkup_subscriptions')
      .delete()
      .eq('id', id)

    if (error) return NextResponse.json({ error: 'Failed to delete custom group' }, { status: 500 })

    return new NextResponse(null, { status: 204 })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
