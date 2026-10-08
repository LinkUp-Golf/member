export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { getCache } from '@/lib/cache'
import { COURSE_PROMO_NS } from '@/lib/cache/keys'
import { validateUUID } from '@/lib/validation'

// POST /api/admin/promotions/reorder  { ids: string[] }
//
// The whole order, top first — each id's position becomes its sort_order.
// Sending the full list rather than a single move means a retry or a double
// tap lands on the same order instead of moving a row twice.
export const POST = withAuth(
  async (req: NextRequest) => {
    const body = await req.json().catch(() => null) as { ids?: unknown } | null
    const ids = body?.ids
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every(id => validateUUID(id, 'id').valid)) {
      return NextResponse.json({ error: 'ids must be a non-empty array of promotion ids' }, { status: 400 })
    }
    if (new Set(ids).size !== ids.length) {
      return NextResponse.json({ error: 'ids must not repeat' }, { status: 400 })
    }

    const admin = createAdminClient()
    const results = await Promise.all(
      (ids as string[]).map((id, index) =>
        admin.from('promotions').update({ sort_order: index }).eq('id', id)
      )
    )
    const failed = results.find(r => r.error)
    if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 500 })

    // Order spans scopes (global and course promos interleave), so bust every course.
    await getCache(COURSE_PROMO_NS).clear('course:promo:').catch(() => {})

    return NextResponse.json({ ok: true })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
