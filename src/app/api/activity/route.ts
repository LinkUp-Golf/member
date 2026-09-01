export const dynamic = 'force-dynamic'

// ============================================================
// POST /api/activity
// Records one client-side activity event for the signed-in member.
//
// The body names an action, not an area — the area and whether it
// counts as a view or an action are looked up server-side from the
// registry, so a client can't file a promotion visit under
// "calendars" or dress a page view up as a transaction. Actions
// flagged server-only (a booking, a cancellation) are rejected here.
// ============================================================

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { logActivity } from '@/lib/activity/log'
import { isClientAction } from '@/lib/activity/areas'
import { validateUUID } from '@/lib/validation'
import type { AuthContext } from '@/lib/auth/types'

const MAX_LABEL_LENGTH = 120
const MAX_PATH_LENGTH  = 200

interface ActivityBody {
  action?: unknown
  targetId?: unknown
  targetLabel?: unknown
  path?: unknown
}

export const POST = withAuth(
  async (req: NextRequest, ctx: AuthContext) => {
    let body: ActivityBody
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }

    const action = typeof body.action === 'string' ? body.action : ''
    if (!isClientAction(action)) {
      return NextResponse.json({ error: 'Unknown activity' }, { status: 400 })
    }

    const targetId =
      typeof body.targetId === 'string' && validateUUID(body.targetId, 'targetId').valid
        ? body.targetId
        : null

    // Trimmed and de-angled rather than run through sanitiseText: this is only
    // ever rendered as React text, and entity-encoding here would surface
    // literal &#x27; in the admin feed.
    const targetLabel =
      typeof body.targetLabel === 'string' && body.targetLabel.trim()
        ? body.targetLabel.replace(/[<>]/g, '').trim().slice(0, MAX_LABEL_LENGTH)
        : null

    // Own path only — a full URL or an off-app path would be someone
    // else's data in our table.
    const path =
      typeof body.path === 'string' && body.path.startsWith('/') && !body.path.startsWith('//')
        ? body.path.slice(0, MAX_PATH_LENGTH)
        : null

    await logActivity({
      memberId: ctx.memberId,
      action,
      courseId: ctx.homeCourseId,
      targetId,
      targetLabel,
      path,
    })

    // 204: the client fires these in the background and ignores the body.
    return new NextResponse(null, { status: 204 }) as NextResponse
  },
  // Page views are frequent and low-sensitivity, so no GHL round-trip per
  // navigation. These share the standard per-member API budget (120/min);
  // the tracker's 5-minute dedupe is what keeps them off it.
  { skipGHLCheck: true }
)
