export const dynamic = 'force-dynamic'

// PATCH /api/admin/courses/reorder
// Persists a new manual display order for courses. Body: { orderedIds: string[] }
// — the full ordered list of course ids for the group being reordered (the
// admin reorders the Active tab, so these are the bookable courses members see
// on the Book screen). Each course's sort_order is set to its index * 10.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { validateUUID } from '@/lib/validation'
import type { AuthContext } from '@/lib/auth/types'

export const PATCH = withAuth(
  async (req: NextRequest, _ctx: AuthContext) => {
    const body = await req.json().catch(() => ({})) as { orderedIds?: unknown }
    const ids = body.orderedIds

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'orderedIds must be a non-empty array' }, { status: 400 })
    }
    if (ids.some(id => !validateUUID(id, 'id').valid)) {
      return NextResponse.json({ error: 'orderedIds must contain valid course ids' }, { status: 400 })
    }
    if (new Set(ids).size !== ids.length) {
      return NextResponse.json({ error: 'orderedIds must not contain duplicates' }, { status: 400 })
    }

    const admin = createAdminClient()

    const results = await Promise.all(
      (ids as string[]).map((id, i) =>
        admin.from('courses').update({ sort_order: (i + 1) * 10 }).eq('id', id)
      )
    )

    const failed = results.find(r => r.error)
    if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 500 })

    return NextResponse.json({ ok: true })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
