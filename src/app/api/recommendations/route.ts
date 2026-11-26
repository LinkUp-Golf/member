export const dynamic = 'force-dynamic'

// GET /api/recommendations — "Recommended for you": the open recommendations
// admins have sent this member, newest first, each with what the two share.
//
// Reading them is seeing them: rows come back stamped seen_at, which is what
// the admin's "Seen" status reads. Members and Home both call this, and
// either one showing a recommendation means the member saw it.
//
// Nothing comes back while the member has Curated Introductions off: off
// stops introductions to them as well as introducing them to others.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { logger } from '@/lib/logger'
import {
  MATCH_MEMBER_SELECT,
  loadMatchMember,
  matchProfileOf,
  toPerson,
  type MatchMemberRow,
} from '@/lib/matching/candidates'
import type { AuthContext } from '@/lib/auth/types'

const MAX_SHOWN = 10

interface Row {
  id: string
  created_at: string
  seen_at: string | null
  suggested: MatchMemberRow | null
}

export const GET = withAuth(async (_req: NextRequest, ctx: AuthContext) => {
  const admin = createAdminClient()
  const [rowsRes, me] = await Promise.all([
    admin
      .from('play_suggestions')
      .select(`id, created_at, seen_at, suggested:members!play_suggestions_suggested_id_fkey(${MATCH_MEMBER_SELECT})`)
      .eq('member_id', ctx.userId)
      .eq('dismissed', false)
      .not('recommended_by', 'is', null)
      .order('created_at', { ascending: false })
      .limit(MAX_SHOWN),
    loadMatchMember(admin, ctx.userId).catch(() => null),
  ])

  if (rowsRes.error) {
    logger.error('Recommendations read failed', { action: 'recommendations.read', errorMessage: rowsRes.error.message })
    return NextResponse.json({ error: 'Could not load your recommendations.' }, { status: 500 })
  }

  const myMatch = me ? matchProfileOf(me) : null
  if (!myMatch?.completed_at || !myMatch.open_to_suggestions) return NextResponse.json([])

  // A recommended member who has since left isn't someone to message.
  const rows = ((rowsRes.data ?? []) as unknown as Row[])
    .flatMap(r => (r.suggested?.membership_status === 'active' ? [{ ...r, suggested: r.suggested }] : []))

  const unseen = rows.filter(r => !r.seen_at).map(r => r.id)
  if (unseen.length > 0) {
    // Best-effort: a failed stamp leaves the admin's status at "Sent".
    await admin.from('play_suggestions').update({ seen_at: new Date().toISOString() }).in('id', unseen)
  }

  // No reason travels with a match (client, 2026-11-24): not the admin's note
  // and not what the two have in common. Members judge each other from the
  // profile, so the response carries the person and nothing about why.
  return NextResponse.json(rows.map(r => ({
    id: r.id,
    sentAt: r.created_at,
    member: toPerson(r.suggested),
  })))
})
