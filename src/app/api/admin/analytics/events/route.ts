export const dynamic = 'force-dynamic'

// ============================================================
// GET /api/admin/analytics/events
// The raw feed behind the report — who visited what, and when.
//
// ?range=7d|30d|90d|all   window (default 30d), or from=&to=
// ?area=<area>            one area of the app
// ?kind=view|action       visits only, or transactions only
// ?memberId=<uuid>        one member's trail
// ?search=                name or email
// ?before=<iso>           keyset page: rows older than this
// ?limit=                 default 50, max 200
// ============================================================

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { logger } from '@/lib/logger'
import { validateUUID } from '@/lib/validation'
import { titleCaseName } from '@/lib/utils'
import {
  ACTIVITY_AREAS,
  AREA_LABELS,
  activitySpec,
  type ActivityArea,
} from '@/lib/activity/areas'
import type { AuthContext } from '@/lib/auth/types'

const RANGE_DAYS = { '7d': 7, '30d': 30, '90d': 90 } as const
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

interface EventRow {
  id: string
  member_id: string
  area: string
  action: string
  kind: string
  target_id: string | null
  target_label: string | null
  path: string | null
  created_at: string
  member: { first_name: string; last_name: string; email: string } | null
}

/** Most rows carry no label of their own — a page view only knows the id it
 *  was pointed at. Resolve them in one query per area so the feed reads as
 *  "Read an announcement · Spring tournament" rather than a bare UUID. */
async function resolveTargetLabels(
  admin: ReturnType<typeof createAdminClient>,
  rows: EventRow[]
): Promise<Map<string, string>> {
  const labels = new Map<string, string>()

  const idsFor = (area: ActivityArea) => [
    ...new Set(
      rows.filter(r => r.area === area && r.target_id && !r.target_label).map(r => r.target_id as string)
    ),
  ]

  const promotionIds   = idsFor('promotions')
  const announcementIds = idsFor('announcements')
  const memberIds      = idsFor('directory')

  const [promotions, announcements, members] = await Promise.all([
    promotionIds.length
      ? admin.from('promotions').select('id, title').in('id', promotionIds)
      : Promise.resolve({ data: [] }),
    announcementIds.length
      ? admin.from('announcements').select('id, title').in('id', announcementIds)
      : Promise.resolve({ data: [] }),
    memberIds.length
      ? admin.from('members').select('id, first_name, last_name').in('id', memberIds)
      : Promise.resolve({ data: [] }),
  ])

  for (const p of (promotions.data ?? []) as Array<{ id: string; title: string }>) {
    labels.set(p.id, p.title)
  }
  for (const a of (announcements.data ?? []) as Array<{ id: string; title: string }>) {
    labels.set(a.id, a.title)
  }
  for (const m of (members.data ?? []) as Array<{ id: string; first_name: string; last_name: string }>) {
    labels.set(m.id, titleCaseName(`${m.first_name} ${m.last_name}`.trim()))
  }

  return labels
}

export const GET = withAuth(
  async (req: NextRequest, _ctx: AuthContext) => {
    const params = req.nextUrl.searchParams
    const admin = createAdminClient()

    const rangeKey = params.get('range') ?? '30d'
    const explicitFrom = params.get('from')
    const to = params.get('to') ? new Date(params.get('to') as string) : new Date()
    const from = explicitFrom
      ? new Date(explicitFrom)
      : rangeKey === 'all'
        ? new Date(0)
        : new Date(
            to.getTime() -
              (RANGE_DAYS[rangeKey as keyof typeof RANGE_DAYS] ?? 30) * 24 * 60 * 60 * 1000
          )

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return NextResponse.json({ error: 'Invalid date range' }, { status: 400 })
    }

    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, parseInt(params.get('limit') ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT)
    )

    let query = admin
      .from('member_activity_events')
      .select(
        'id, member_id, area, action, kind, target_id, target_label, path, created_at, member:members(first_name, last_name, email)'
      )
      .gte('created_at', from.toISOString())
      .lt('created_at', to.toISOString())
      .order('created_at', { ascending: false })
      .limit(limit)

    const areaParam = params.get('area')
    if (ACTIVITY_AREAS.includes(areaParam as ActivityArea)) query = query.eq('area', areaParam)

    const kind = params.get('kind')
    if (kind === 'view' || kind === 'action') query = query.eq('kind', kind)

    const memberId = params.get('memberId')
    if (memberId && validateUUID(memberId, 'memberId').valid) query = query.eq('member_id', memberId)

    // Keyset rather than offset: the feed is append-only and admins page
    // backwards through it, so an offset would re-read rows that shifted.
    const before = params.get('before')
    if (before && !Number.isNaN(new Date(before).getTime())) query = query.lt('created_at', before)

    const { data, error } = await query

    if (error) {
      logger.error('Activity feed failed', {
        action: 'admin.analytics.events',
        errorMessage: error.message,
      })
      return NextResponse.json({ error: 'Could not load activity.' }, { status: 500 })
    }

    // The embed comes back as an object for a to-one relation, but PostgREST
    // types it loosely enough that an array is worth handling.
    const rows = ((data ?? []) as unknown as Array<Omit<EventRow, 'member'> & {
      member: EventRow['member'] | EventRow['member'][]
    }>).map(row => ({
      ...row,
      member: Array.isArray(row.member) ? (row.member[0] ?? null) : row.member,
    })) as EventRow[]

    // Applied after the fetch, not as a filter on the embedded table: an
    // inner-join filter would silently drop events whose member row was
    // removed, which is exactly the history a usage report should keep.
    const search = (params.get('search') ?? '').trim().toLowerCase()
    const visible = search
      ? rows.filter(row =>
          `${row.member?.first_name ?? ''} ${row.member?.last_name ?? ''} ${row.member?.email ?? ''}`
            .toLowerCase()
            .includes(search)
        )
      : rows

    const labels = await resolveTargetLabels(admin, visible)

    return NextResponse.json({
      events: visible.map(row => {
        const spec = activitySpec(row.action)
        return {
          id:          row.id,
          memberId:    row.member_id,
          // Title-cased for the same reason as the roster: GHL stores names as
          // typed, so half of them arrive lower-case.
          memberName:  row.member
            ? titleCaseName(`${row.member.first_name} ${row.member.last_name}`.trim())
            : 'Removed member',
          memberEmail: row.member?.email ?? null,
          area:        row.area,
          areaLabel:   AREA_LABELS[row.area as ActivityArea] ?? row.area,
          action:      row.action,
          actionLabel: spec?.label ?? row.action,
          kind:        row.kind,
          targetId:    row.target_id,
          targetLabel: row.target_label ?? (row.target_id ? labels.get(row.target_id) ?? null : null),
          path:        row.path,
          createdAt:   row.created_at,
        }
      }),
      // The cursor comes off the unfiltered page: search narrows what's shown,
      // but paging must still walk the underlying rows.
      nextCursor: rows.length === limit ? rows[rows.length - 1]?.created_at ?? null : null,
    })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
