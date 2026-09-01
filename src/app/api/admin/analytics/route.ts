export const dynamic = 'force-dynamic'

// ============================================================
// GET /api/admin/analytics
// Member usage report: who used the app, who didn't, and which
// areas they touched.
//
// ?range=7d|30d|90d|all   window (default 30d), or from=&to= (ISO dates)
// ?area=<area>            narrow every count to one area of the app
// ?kind=view|action       visits only, or transactions only
// ?courseId=<uuid>        members of one course
// ?engagement=            active | dormant | never (see ENGAGEMENT below)
// ?search=                name or email
// ?includeAdmins=1        admins are excluded by default — their app use
//                         isn't what this report is measuring
// ?sort=activity|recent|idle|name
// ?page=1&pageSize=25|50|100   roster page (default 25); pageSize=all
//                              returns every matching row, for CSV export
// ============================================================

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { logger } from '@/lib/logger'
import { validateUUID } from '@/lib/validation'
import { ACTIVITY_AREAS, AREA_LABELS, type ActivityArea } from '@/lib/activity/areas'
import { titleCaseName } from '@/lib/utils'
import { PAGE_SIZES, DEFAULT_PAGE_SIZE, type PageSize } from '@/lib/activity/report'
import type { AuthContext } from '@/lib/auth/types'

const RANGES = { '7d': 7, '30d': 30, '90d': 90 } as const
type RangeKey = keyof typeof RANGES | 'all'

const ENGAGEMENTS = ['all', 'active', 'dormant', 'never'] as const
type Engagement = (typeof ENGAGEMENTS)[number]

const SORTS = ['activity', 'recent', 'idle', 'name'] as const
type Sort = (typeof SORTS)[number]


interface RollupRow {
  member_id: string
  first_name: string
  last_name: string
  email: string
  membership_status: string
  is_admin: boolean
  home_course_id: string | null
  course_name: string | null
  joined_at: string
  last_sign_in: string | null
  total_events: number
  view_events: number
  action_events: number
  last_event_at: string | null
  calendars_events: number
  promotions_events: number
  announcements_events: number
  directory_events: number
}

interface AreaRow {
  area: string
  view_events: number
  action_events: number
  total_events: number
  unique_members: number
}

interface DailyRow {
  day: string
  total_events: number
  action_events: number
  active_members: number
}

/** The window the report covers. `all` starts at the epoch so the RPCs keep
 *  one signature — the index is on created_at either way. */
function resolveRange(params: URLSearchParams): { from: Date; to: Date; key: RangeKey } {
  const explicitFrom = params.get('from')
  const explicitTo = params.get('to')

  if (explicitFrom) {
    const from = new Date(explicitFrom)
    const to = explicitTo ? new Date(explicitTo) : new Date()
    if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && from < to) {
      return { from, to, key: 'all' }
    }
  }

  const raw = params.get('range')
  const key: RangeKey = raw === 'all' || (raw && raw in RANGES) ? (raw as RangeKey) : '30d'
  const to = new Date()
  const from =
    key === 'all'
      ? new Date(0)
      : new Date(to.getTime() - RANGES[key as keyof typeof RANGES] * 24 * 60 * 60 * 1000)

  return { from, to, key }
}

const MAX_TREND_DAYS = 180
const DAY_MS = 24 * 60 * 60 * 1000

interface DailyPoint {
  day: string
  totalEvents: number
  actionEvents: number
  activeMembers: number
}

function fillDailyGaps(rows: DailyRow[], from: Date, to: Date): DailyPoint[] {
  const firstRow = rows[0]
  if (!firstRow) return []

  const byDay = new Map(rows.map(r => [r.day, r]))

  // "All time" starts at the epoch, so the series begins at the first day that
  // actually has activity rather than 1970. Long windows are trimmed to the
  // most recent MAX_TREND_DAYS — beyond that the bars are thinner than a pixel.
  const firstDay = new Date(`${firstRow.day}T00:00:00Z`)
  const start = new Date(Math.max(from.getTime(), firstDay.getTime()))
  const end = new Date(Math.min(to.getTime(), Date.now()))
  const spanDays = Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1
  const days = Math.min(Math.max(spanDays, 1), MAX_TREND_DAYS)
  const firstShown = new Date(end.getTime() - (days - 1) * DAY_MS)

  const series: DailyPoint[] = []
  for (let i = 0; i < days; i++) {
    const day = new Date(firstShown.getTime() + i * DAY_MS).toISOString().slice(0, 10)
    const row = byDay.get(day)
    series.push({
      day,
      totalEvents:   Number(row?.total_events ?? 0),
      actionEvents:  Number(row?.action_events ?? 0),
      activeMembers: Number(row?.active_members ?? 0),
    })
  }
  return series
}

export const GET = withAuth(
  async (req: NextRequest, _ctx: AuthContext) => {
    const params = req.nextUrl.searchParams
    const { from, to, key: rangeKey } = resolveRange(params)

    const areaParam = params.get('area')
    const area: ActivityArea | null = ACTIVITY_AREAS.includes(areaParam as ActivityArea)
      ? (areaParam as ActivityArea)
      : null

    const kindParam = params.get('kind')
    const kind = kindParam === 'view' || kindParam === 'action' ? kindParam : null

    // Reaches a `uuid` RPC parameter, so anything that isn't one becomes "no
    // course filter" rather than a cast error behind a 500.
    const courseIdParam = params.get('courseId')
    const courseId =
      courseIdParam && validateUUID(courseIdParam, 'courseId').valid ? courseIdParam : null

    const engagementParam = params.get('engagement')
    const engagement: Engagement = ENGAGEMENTS.includes(engagementParam as Engagement)
      ? (engagementParam as Engagement)
      : 'all'

    const sortParam = params.get('sort')
    const sort: Sort = SORTS.includes(sortParam as Sort) ? (sortParam as Sort) : 'activity'

    const search = (params.get('search') ?? '').trim().toLowerCase()
    const includeAdmins = params.get('includeAdmins') === '1'

    // pageSize=all is what the CSV export asks for — the whole filtered set,
    // not the page the admin happens to be looking at.
    const pageSizeParam = params.get('pageSize')
    const pageSizeRaw = Number(pageSizeParam)
    const exportAll = pageSizeParam === 'all'
    const pageSize: PageSize = PAGE_SIZES.includes(pageSizeRaw as PageSize)
      ? (pageSizeRaw as PageSize)
      : DEFAULT_PAGE_SIZE
    const requestedPage = Math.max(1, parseInt(params.get('page') ?? '1', 10) || 1)

    const admin = createAdminClient()
    const fromIso = from.toISOString()
    const toIso = to.toISOString()

    // All three reports read the same window; run them together rather than
    // in sequence.
    const [rollupRes, areasRes, dailyRes, coursesRes, firstEventRes] = await Promise.all([
      admin.rpc('member_activity_rollup', {
        p_from: fromIso,
        p_to: toIso,
        p_area: area,
        p_kind: kind,
      }),
      // The aggregates take the same population filters as the roster —
      // otherwise the area cards would count admins and other courses while
      // the headline stats above them didn't.
      admin.rpc('activity_area_breakdown', {
        p_from: fromIso,
        p_to: toIso,
        p_kind: kind,
        p_course_id: courseId,
        // The RPCs still take a membership-status filter, but nothing asks for
        // one: a report about whether people open the app reads the same for a
        // waitlisted member as an active one. Left in the signature so bringing
        // it back is a route change, not a migration.
        p_status: null,
        p_include_admins: includeAdmins,
      }),
      admin.rpc('activity_daily_totals', {
        p_from: fromIso,
        p_to: toIso,
        p_area: area,
        p_kind: kind,
        p_course_id: courseId,
        p_status: null,
        p_include_admins: includeAdmins,
      }),
      admin.from('courses').select('id, name').eq('active', true).order('name'),
      // Live rows only. The seeder backfills sign-ins and past transactions,
      // so the earliest row overall predates tracking by months — quoting that
      // as the tracking-start date would claim measurement that never happened.
      admin
        .from('member_activity_events')
        .select('created_at')
        .is('metadata->>backfilled', null)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle(),
    ])

    if (rollupRes.error || areasRes.error || dailyRes.error) {
      logger.error('Analytics report failed', {
        action: 'admin.analytics',
        errorMessage:
          rollupRes.error?.message ?? areasRes.error?.message ?? dailyRes.error?.message ?? 'unknown',
      })
      return NextResponse.json({ error: 'Could not build the report.' }, { status: 500 })
    }

    const allRows = (rollupRes.data ?? []) as RollupRow[]

    // ---- Population -----------------------------------------
    // Every rate below is measured against this set, so the admin and course
    // filters narrow the denominator too — 40% of a course is a different
    // claim from 40% of the membership.
    const population = allRows.filter(row => {
      if (!includeAdmins && row.is_admin) return false
      if (courseId && row.home_course_id !== courseId) return false
      return true
    })

    const usedInRange = population.filter(row => row.total_events > 0)
    const neverSignedIn = population.filter(row => !row.last_sign_in)
    const dormant = population.filter(row => row.total_events === 0 && row.last_sign_in)

    const summary = {
      totalMembers:   population.length,
      usedApp:        usedInRange.length,
      dormant:        dormant.length,
      neverSignedIn:  neverSignedIn.length,
      totalEvents:    usedInRange.reduce((sum, r) => sum + Number(r.total_events), 0),
      viewEvents:     usedInRange.reduce((sum, r) => sum + Number(r.view_events), 0),
      actionEvents:   usedInRange.reduce((sum, r) => sum + Number(r.action_events), 0),
      adoptionRate:   population.length
        ? Math.round((usedInRange.length / population.length) * 100)
        : 0,
    }

    // ---- Member rows ----------------------------------------
    const searched = search
      ? population.filter(row =>
          `${row.first_name} ${row.last_name} ${row.email}`.toLowerCase().includes(search)
        )
      : population

    const engaged = searched.filter(row => {
      switch (engagement) {
        case 'active':  return row.total_events > 0
        case 'dormant': return row.total_events === 0 && Boolean(row.last_sign_in)
        case 'never':   return !row.last_sign_in
        default:        return true
      }
    })

    const time = (value: string | null) => (value ? new Date(value).getTime() : 0)

    const members = [...engaged].sort((a, b) => {
      switch (sort) {
        case 'recent':
          return time(b.last_event_at) - time(a.last_event_at)
        case 'idle':
          // Least recently seen first — the follow-up list. Members who have
          // never signed in sort to the top, since 0 is the oldest timestamp.
          return time(a.last_event_at || a.last_sign_in) - time(b.last_event_at || b.last_sign_in)
        case 'name':
          return `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`)
        default:
          return (
            Number(b.total_events) - Number(a.total_events) ||
            time(b.last_event_at) - time(a.last_event_at)
          )
      }
    })

    // ---- Paging ---------------------------------------------
    // Applied last, so the summary and the area breakdown still describe the
    // whole filtered population rather than whichever 25 rows are on screen.
    const total = members.length
    const totalPages = exportAll ? 1 : Math.max(1, Math.ceil(total / pageSize))
    // A filter change can shrink the roster below the current page; clamping
    // shows the last page instead of an empty table with no explanation.
    const page = Math.min(requestedPage, totalPages)
    const pageRows = exportAll ? members : members.slice((page - 1) * pageSize, page * pageSize)

    // ---- Area breakdown -------------------------------------
    // Every known area is returned, including the untouched ones: "nobody
    // opened promotions this month" is a finding, not a missing row.
    const byArea = new Map<string, AreaRow>(
      ((areasRes.data ?? []) as AreaRow[]).map(r => [r.area, r])
    )
    const areas = ACTIVITY_AREAS.map(name => {
      const row = byArea.get(name)
      return {
        area:          name,
        label:         AREA_LABELS[name],
        viewEvents:    Number(row?.view_events ?? 0),
        actionEvents:  Number(row?.action_events ?? 0),
        totalEvents:   Number(row?.total_events ?? 0),
        uniqueMembers: Number(row?.unique_members ?? 0),
      }
    }).sort((a, b) => b.totalEvents - a.totalEvents)

    // The RPC returns only days that had activity. Handing those straight to a
    // bar chart would draw a quiet week as narrow as a busy day, so the empty
    // days are filled in here — the page renders what it's given.
    const daily = fillDailyGaps((dailyRes.data ?? []) as DailyRow[], from, to)

    return NextResponse.json({
      range: { from: fromIso, to: toIso, key: rangeKey },
      trackingSince: firstEventRes.data?.created_at ?? null,
      filters: { area, kind, courseId, engagement, sort, search, includeAdmins },
      pagination: {
        page,
        pageSize: exportAll ? total : pageSize,
        total,
        totalPages,
        pageSizes: PAGE_SIZES,
      },
      summary,
      areas,
      daily,
      members: pageRows.map(row => ({
        memberId:      row.member_id,
        // GHL stores names however they were typed, so they arrive lower-case
        // as often as not. Title-cased here rather than with CSS `capitalize`
        // so the CSV export reads the same as the table.
        name:          titleCaseName(`${row.first_name} ${row.last_name}`.trim()),
        email:         row.email,
        status:        row.membership_status,
        isAdmin:       row.is_admin,
        courseName:    row.course_name,
        joinedAt:      row.joined_at,
        lastSignIn:    row.last_sign_in,
        lastEventAt:   row.last_event_at,
        totalEvents:   Number(row.total_events),
        viewEvents:    Number(row.view_events),
        actionEvents:  Number(row.action_events),
        calendars:     Number(row.calendars_events),
        promotions:    Number(row.promotions_events),
        announcements: Number(row.announcements_events),
        directory:     Number(row.directory_events),
      })),
      courses: (coursesRes.data ?? []) as Array<{ id: string; name: string }>,
    })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
