export const dynamic = 'force-dynamic'

// GET  /api/admin/matching/[memberId]?offset=&limit= — the member, a page of
//   the players who fit them (best first, 20 by default), how many fit in all,
//   how many their preferred introductions ruled out, and what admins have already
//   sent them.
// POST /api/admin/matching/[memberId] — send introductions:
//   { picks: [{ candidateId, note? }] }. Every match is two-sided (client,
//   2026-11-24): a play_suggestions row is written for the member AND one for
//   each recommended player, so both have the other in their Curated
//   Introductions queue, and both get the same "new match" push and email —
//   no name, no reason. The note is optional and internal: an admin's record
//   of why, never sent to or shown to a member.
//
// The list is rebuilt for a POST rather than trusted from the request: the
// admin's screen isn't the authority on who fits. A pick that isn't on the
// list now — ruled out by a preference, played with since, dismissed, or
// already sent in either direction — is refused, so a stale screen can't send
// a match the member said they don't want, or send one pair twice.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { logger } from '@/lib/logger'
import { notifyMember } from '@/lib/notify'
import { NotificationTemplates } from '@/lib/push'
import { validateUUID } from '@/lib/validation'
import {
  buildCandidateList,
  loadMatchMember,
  loadSentRecommendations,
  summarize,
} from '@/lib/matching/candidates'
import { parsePage } from '@/lib/matching/queue'
import { MAX_NOTE_LENGTH } from '@/lib/matching/rules'
import type { AuthContext } from '@/lib/auth/types'

/** The most recommendations one send may carry. */
const MAX_PICKS = 5

type RouteCtx = { params: Record<string, string> }

function memberIdFrom(routeCtx?: RouteCtx): string | null {
  const id = routeCtx?.params?.['memberId']
  return id && validateUUID(id, 'memberId').valid ? id : null
}

export const GET = withAuth(
  async (req: NextRequest, _ctx: AuthContext, routeCtx?: RouteCtx) => {
    const memberId = memberIdFrom(routeCtx)
    if (!memberId) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    const page = parsePage(req.nextUrl.searchParams)

    const admin = createAdminClient()
    try {
      const member = await loadMatchMember(admin, memberId)
      if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

      const summary = summarize(member)
      // Off, or never answered: there is nobody to introduce them to.
      const [list, sent] = await Promise.all([
        summary.openToSuggestions ? buildCandidateList(admin, member) : Promise.resolve({ candidates: [], ruledOut: 0 }),
        loadSentRecommendations(admin, memberId),
      ])
      // The whole list is scored either way (ranking needs everyone); only
      // the page goes over the wire.
      return NextResponse.json({
        member: summary,
        candidates: list.candidates.slice(page.offset, page.offset + page.limit),
        total: list.candidates.length,
        ruledOut: list.ruledOut,
        sent,
      })
    } catch (err) {
      logger.error('Matching candidates failed', {
        action: 'admin.matching.candidates',
        errorMessage: err instanceof Error ? err.message : String(err),
        metadata: { memberId },
      })
      return NextResponse.json({ error: 'Could not load candidates for this member.' }, { status: 500 })
    }
  },
  { requireAdmin: true, skipGHLCheck: true },
)

interface Pick {
  candidateId: string
  note: string | null
}

function parsePicks(body: unknown): Pick[] | string {
  const picks = (body as { picks?: unknown } | null)?.picks
  if (!Array.isArray(picks) || picks.length === 0) return 'Choose at least one player to recommend.'
  if (picks.length > MAX_PICKS) return `Send up to ${MAX_PICKS} recommendations at a time.`
  const parsed: Pick[] = []
  for (const p of picks) {
    const candidateId = (p as { candidateId?: unknown })?.candidateId
    const note = (p as { note?: unknown })?.note
    if (typeof candidateId !== 'string' || !validateUUID(candidateId, 'candidateId').valid) {
      return 'One of the players is not recognised.'
    }
    if (note != null && typeof note !== 'string') return 'A note must be text.'
    const text = typeof note === 'string' ? note.trim() : ''
    if (text.length > MAX_NOTE_LENGTH) return `Keep each note under ${MAX_NOTE_LENGTH} characters.`
    if (parsed.some(x => x.candidateId === candidateId)) continue
    parsed.push({ candidateId, note: text || null })
  }
  return parsed
}

export const POST = withAuth(
  async (req: NextRequest, ctx: AuthContext, routeCtx?: RouteCtx) => {
    const memberId = memberIdFrom(routeCtx)
    if (!memberId) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

    const picks = parsePicks(await req.json().catch(() => null))
    if (typeof picks === 'string') return NextResponse.json({ error: picks }, { status: 400 })

    const admin = createAdminClient()
    const member = await loadMatchMember(admin, memberId).catch(() => null)
    if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    const summary = summarize(member)
    if (!summary.surveyCompleted) {
      return NextResponse.json({ error: "This member hasn't turned on Curated Introductions." }, { status: 409 })
    }
    if (!summary.openToSuggestions) {
      return NextResponse.json({ error: 'This member has turned off Curated Introductions.' }, { status: 409 })
    }

    let list
    try {
      list = await buildCandidateList(admin, member)
    } catch {
      return NextResponse.json({ error: 'Could not check the candidates. Please try again.' }, { status: 500 })
    }
    const byId = new Map(list.candidates.map(c => [c.id, c]))
    const chosen = picks.map(p => byId.get(p.candidateId))
    if (chosen.some(c => !c || c.recommendedAt || c.suggestedAt)) {
      return NextResponse.json(
        { error: 'One of these players can no longer be recommended to this member. Refresh the list and try again.' },
        { status: 409 },
      )
    }

    // Two rows per match, one for each side, so both have it in their queue.
    // One row per ordered pair: re-sending a pair dismissed long ago reopens it.
    const now = new Date().toISOString()
    const row = (owner: string, other: string, note: string | null) => ({
      member_id: owner,
      suggested_id: other,
      recommended_by: ctx.userId,
      note,
      dismissed: false,
      dismissed_at: null,
      seen_at: null,
      created_at: now,
    })
    const { error } = await admin.from('play_suggestions').upsert(
      picks.flatMap(p => [row(memberId, p.candidateId, p.note), row(p.candidateId, memberId, p.note)]),
      { onConflict: 'member_id,suggested_id' },
    )
    if (error) {
      logger.error('Recommendation send failed', { action: 'admin.matching.send', errorMessage: error.message })
      return NextResponse.json({ error: 'Could not send. Please try again.' }, { status: 500 })
    }

    // Same message to both sides: no name, no reason.
    void notifyMember(memberId, NotificationTemplates.curatedIntroduction(picks.length))
    for (const p of picks) void notifyMember(p.candidateId, NotificationTemplates.curatedIntroduction())

    return NextResponse.json({ sent: picks.length })
  },
  { requireAdmin: true, skipGHLCheck: true },
)
