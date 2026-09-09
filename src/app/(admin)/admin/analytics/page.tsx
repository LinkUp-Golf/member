'use client'

// ============================================================
// Member usage report — who uses the app, who doesn't, and what
// they do in calendars, promotions, announcements and the member
// directory.
//
// Every number comes from /api/admin/analytics, which reads the
// member_activity_events table through admin-only RPCs. This page
// renders what it's given and owns only the filter state.
//
// Filter layout follows what each control actually scopes: the
// row under the header re-cuts every figure on the page, while
// search / engagement / sort sit on the roster, which is all they
// narrow.
// ============================================================

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  AdminPageHeader,
  AdminCard,
  AdminTable,
  AdminTr,
  AdminTd,
  Badge,
} from '@/components/admin/AdminUI'
import ActivityFeed from '@/components/admin/ActivityFeed'
import Select, { type SelectOption } from '@/components/ui/Select'
import ActivityCharts, { type DailyPoint } from '@/components/admin/ActivityCharts'
import { ContentLoader } from '@/components/ui/Loading'
import { ACTIVITY_AREAS, AREA_LABELS, FOCUS_AREAS, type ActivityArea } from '@/lib/activity/areas'
import { PAGE_SIZES, DEFAULT_PAGE_SIZE, type PageSize } from '@/lib/activity/report'
import { format, formatDistanceToNow } from 'date-fns'

type RangeKey = '7d' | '30d' | '90d' | 'all'
type KindFilter = 'all' | 'view' | 'action'
type Engagement = 'all' | 'active' | 'dormant' | 'never'
type Sort = 'activity' | 'recent' | 'idle' | 'name'

const RANGE_LABELS: Record<RangeKey, string> = {
  '7d':  'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  all:   'All time',
}

const ENGAGEMENT_LABELS: Record<Engagement, string> = {
  all:     'Everyone',
  active:  'Used the app',
  dormant: 'Signed in, no activity',
  never:   'Never signed in',
}

const SORT_LABELS: Record<Sort, string> = {
  activity: 'Most active',
  recent:   'Most recently seen',
  idle:     'Longest inactive',
  name:     'Name (A–Z)',
}

interface AreaStat {
  area: ActivityArea
  label: string
  viewEvents: number
  actionEvents: number
  totalEvents: number
  uniqueMembers: number
}

interface MemberRow {
  memberId: string
  name: string
  email: string
  status: string
  isAdmin: boolean
  courseName: string | null
  joinedAt: string
  lastSignIn: string | null
  lastEventAt: string | null
  totalEvents: number
  viewEvents: number
  actionEvents: number
  calendars: number
  promotions: number
  announcements: number
  directory: number
}

interface Report {
  range: { from: string; to: string; key: RangeKey }
  trackingSince: string | null
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  summary: {
    totalMembers: number
    usedApp: number
    dormant: number
    neverSignedIn: number
    totalEvents: number
    viewEvents: number
    actionEvents: number
    adoptionRate: number
  }
  areas: AreaStat[]
  daily: DailyPoint[]
  members: MemberRow[]
  courses: Array<{ id: string; name: string }>
}

/** Matches the admin field styling used across the other admin panels, passed
 *  to Select so the portal dropdown doesn't inherit the member-app green. */
const TRIGGER_CLASS =
  'w-full px-3 py-2 text-sm rounded-xl border border-gray-200 focus:border-green-700 outline-none transition-colors bg-white text-gray-700 flex items-center justify-between gap-2'

const KIND_OPTIONS: SelectOption[] = [
  { value: 'all',    label: 'Visits & actions' },
  { value: 'view',   label: 'Visits only' },
  { value: 'action', label: 'Actions only' },
]

const ENGAGEMENT_OPTIONS: SelectOption[] = (
  Object.keys(ENGAGEMENT_LABELS) as Engagement[]
).map(value => ({ value, label: ENGAGEMENT_LABELS[value] }))

const SORT_OPTIONS: SelectOption[] = (Object.keys(SORT_LABELS) as Sort[]).map(value => ({
  value,
  label: SORT_LABELS[value],
}))

const PAGE_SIZE_OPTIONS: SelectOption[] = PAGE_SIZES.map(size => ({
  value: String(size),
  label: `${size} per page`,
}))

/** Placed on the roster row, not in the scope row above: like search and
 *  engagement, it picks out rows to work through without changing what the
 *  adoption rate and the area cards are measured against. */
const TAG_OPTION_ALL: SelectOption = { value: 'all', label: 'Any GHL tag' }

const AREA_OPTIONS: SelectOption[] = [
  { value: 'all', label: 'App functions' },
  ...ACTIVITY_AREAS.map(name => ({ value: name, label: AREA_LABELS[name] })),
]

export default function AdminAnalyticsPage() {
  // Scope filters — these re-cut every figure on the page.
  const [range, setRange]                 = useState<RangeKey>('30d')
  const [area, setArea]                   = useState<ActivityArea | 'all'>('all')
  const [kind, setKind]                   = useState<KindFilter>('all')
  const [courseId, setCourseId]           = useState<string>('all')
  const [includeAdmins, setIncludeAdmins] = useState(false)

  // Roster-only controls.
  const [engagement, setEngagement] = useState<Engagement>('all')
  const [sort, setSort]             = useState<Sort>('activity')
  const [tag, setTag]               = useState<string>('all')
  const [search, setSearch]         = useState('')
  const [page, setPage]             = useState(1)
  const [pageSize, setPageSize]     = useState<PageSize>(DEFAULT_PAGE_SIZE)

  // The tag list comes from GHL itself, not from the tags our members happen
  // to carry — an admin filtering on a campaign tag nobody has yet should see
  // an empty roster, not a missing option.
  const [ghlTags, setGhlTags] = useState<string[]>([])
  useEffect(() => {
    fetch('/api/admin/ghl/tags')
      .then(r => r.json())
      .then(d => setGhlTags(((d.tags ?? []) as Array<{ name?: string }>)
        .map(t => (t.name ?? '').trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))))
      // A GHL outage costs the tag filter its options, not the report.
      .catch(() => setGhlTags([]))
  }, [])

  const [report, setReport]     = useState<Report | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [selected, setSelected] = useState<MemberRow | null>(null)
  const [exporting, setExporting] = useState(false)

  // Typing shouldn't refire the report on every keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(timer)
  }, [search])

  /** Everything except paging — the server clamps an out-of-range page, but
   *  landing on page 7 of a 2-page result is still a worse read than page 1. */
  const filterKey = useMemo(
    () => [range, area, kind, courseId, includeAdmins, engagement, tag, debouncedSearch].join('|'),
    [range, area, kind, courseId, includeAdmins, engagement, tag, debouncedSearch]
  )
  useEffect(() => { setPage(1) }, [filterKey, pageSize])

  const baseParams = useCallback(() => {
    const params = new URLSearchParams({ range, sort, engagement })
    if (area !== 'all')     params.set('area', area)
    if (kind !== 'all')     params.set('kind', kind)
    if (courseId !== 'all') params.set('courseId', courseId)
    if (tag !== 'all')      params.set('tag', tag)
    if (debouncedSearch)    params.set('search', debouncedSearch)
    if (includeAdmins)      params.set('includeAdmins', '1')
    return params
  }, [range, sort, engagement, area, kind, courseId, tag, debouncedSearch, includeAdmins])

  const reportQuery = useMemo(() => {
    const params = baseParams()
    params.set('page', String(page))
    params.set('pageSize', String(pageSize))
    return params.toString()
  }, [baseParams, page, pageSize])

  /** The feed shares the window and the area/kind lens, but not the
   *  member-level filters — those narrow a roster, not an event stream. */
  const feedQuery = useMemo(() => {
    const params = new URLSearchParams({ range })
    if (area !== 'all')  params.set('area', area)
    if (kind !== 'all')  params.set('kind', kind)
    if (debouncedSearch) params.set('search', debouncedSearch)
    return params.toString()
  }, [range, area, kind, debouncedSearch])

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/admin/analytics?${reportQuery}`)
    const json = await res.json().catch(() => ({}))
    if (res.ok) {
      setError(null)
      setReport(json as Report)
    } else {
      // Without this a failed load renders as a confident "nobody used the app".
      setError(json.error ?? 'Could not load the report.')
    }
    setLoading(false)
  }, [reportQuery])

  useEffect(() => { load() }, [load])

  const areaOptions = AREA_OPTIONS

  const tagOptions: SelectOption[] = useMemo(
    () => [TAG_OPTION_ALL, ...ghlTags.map(name => ({ value: name, label: name }))],
    [ghlTags]
  )

  const courseOptions: SelectOption[] = useMemo(
    () => [
      { value: 'all', label: 'Any course' },
      ...(report?.courses ?? []).map(course => ({ value: course.id, label: course.name })),
    ],
    [report]
  )

  const clearFilters = useCallback(() => {
    setArea('all')
    setKind('all')
    setCourseId('all')
    setEngagement('all')
    setTag('all')
  }, [])

  const focusAreas = useMemo(
    () =>
      FOCUS_AREAS.map(
        name =>
          report?.areas.find(a => a.area === name) ?? {
            area: name,
            label: AREA_LABELS[name],
            viewEvents: 0,
            actionEvents: 0,
            totalEvents: 0,
            uniqueMembers: 0,
          }
      ),
    [report]
  )

  const otherAreas = useMemo(
    () => (report?.areas ?? []).filter(a => !FOCUS_AREAS.includes(a.area as never) && a.totalEvents > 0),
    [report]
  )

  /** Exports the whole filtered roster, not the page on screen — a CSV of 10
   *  rows when the filter matched 400 is a quietly wrong answer. */
  async function exportCsv() {
    if (exporting) return
    setExporting(true)
    try {
      const params = baseParams()
      params.set('pageSize', 'all')
      const res = await fetch(`/api/admin/analytics?${params.toString()}`)
      const json = (await res.json()) as Report
      if (!res.ok) throw new Error('export failed')

      const header = [
        'Name', 'Email', 'Status', 'Course', 'Last sign-in', 'Last activity',
        'Total events', 'Visits', 'Actions', 'Calendars', 'Promotions', 'Announcements', 'Directory',
      ]
      const escape = (value: string) => `"${value.replace(/"/g, '""')}"`
      const rows = json.members.map(m =>
        [
          m.name, m.email, m.status, m.courseName ?? '',
          m.lastSignIn ? format(new Date(m.lastSignIn), 'yyyy-MM-dd HH:mm') : 'Never',
          m.lastEventAt ? format(new Date(m.lastEventAt), 'yyyy-MM-dd HH:mm') : '',
          m.totalEvents, m.viewEvents, m.actionEvents,
          m.calendars, m.promotions, m.announcements, m.directory,
        ].map(value => escape(String(value))).join(',')
      )
      const blob = new Blob([[header.map(escape).join(','), ...rows].join('\n')], {
        type: 'text/csv;charset=utf-8;',
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `member-activity-${range}-${format(new Date(), 'yyyy-MM-dd')}.csv`
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      setError('Could not build the export.')
    }
    setExporting(false)
  }

  const pagination = report?.pagination
  const firstRow = pagination ? (pagination.page - 1) * pageSize + 1 : 0
  const lastRow = pagination ? Math.min(pagination.page * pageSize, pagination.total) : 0

  return (
    <div className="p-4 sm:p-8">
      <AdminPageHeader
        title="Utilization"
        description="Who is using the app, who isn't, and what they do once they're in."
        action={
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
            {(Object.keys(RANGE_LABELS) as RangeKey[]).map(option => (
              <button
                key={option}
                onClick={() => setRange(option)}
                className={`px-2.5 sm:px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  range === option ? 'bg-white text-green-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {option === 'all' ? 'All' : option}
              </button>
            ))}
          </div>
        }
      />

      {/* ---- Scope filters: everything below re-cuts against these ---- */}
      {/* One column on a phone, two on a tablet, a single row on desktop —
          a wrapped row of half-width dropdowns is the worst of both. */}
      <div className="-mt-2 mb-5 grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center gap-2">
        <Select
          options={areaOptions}
          value={area}
          onChange={next => setArea(next as ActivityArea | 'all')}
          searchPlaceholder="Search app functions…"
          className="lg:w-44"
          triggerClassName={TRIGGER_CLASS}
        />

        <Select
          options={KIND_OPTIONS}
          value={kind}
          onChange={next => setKind(next as KindFilter)}
          className="lg:w-44"
          triggerClassName={TRIGGER_CLASS}
        />

        {courseOptions.length > 2 && (
          <Select
            options={courseOptions}
            value={courseId}
            onChange={setCourseId}
            searchPlaceholder="Search courses…"
            className="lg:w-52"
            triggerClassName={TRIGGER_CLASS}
          />
        )}

        <div className="flex items-center justify-between gap-3 sm:col-span-2 lg:col-span-1">
          <label className="flex items-center gap-2 text-sm text-gray-600 whitespace-nowrap">
            <input
              type="checkbox"
              checked={includeAdmins}
              onChange={e => setIncludeAdmins(e.target.checked)}
              className="rounded border-gray-300"
            />
            Include admins
          </label>

          {(area !== 'all' || kind !== 'all' || courseId !== 'all' || engagement !== 'all' || tag !== 'all') && (
            <button
              onClick={clearFilters}
              className="text-xs font-medium text-green-800 hover:text-green-900 whitespace-nowrap"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Sign-ins and past transactions were backfilled from existing records,
          so "dormant" isn't read as "never used the app" for a member whose
          use predates this table. */}
      {report?.trackingSince && (
        <p className="text-xs text-gray-400 -mt-4 mb-6">
          Live tracking since {format(new Date(report.trackingSince), 'd MMM yyyy')}; sign-ins and
          bookings before that were backfilled from existing records.
        </p>
      )}

      {loading && !report ? (
        <ContentLoader />
      ) : error ? (
        <AdminCard>
          <div className="py-10 text-center">
            <p className="text-sm text-red-500">{error}</p>
            <button onClick={load} className="btn btn-outline btn-sm mt-4">Try again</button>
          </div>
        </AdminCard>
      ) : report ? (
        // Refetch keeps the frame: the previous render dims rather than
        // collapsing to a skeleton and bouncing the layout.
        <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          {/* ---- Adoption ------------------------------------ */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-3">
            <button
              type="button"
              onClick={() => setEngagement(engagement === 'active' ? 'all' : 'active')}
              aria-pressed={engagement === 'active'}
              className={`text-left bg-white rounded-xl border p-5 shadow-sm transition-colors lg:col-span-1 ${
                engagement === 'active' ? 'border-green-700 ring-1 ring-green-700/20' : 'border-gray-100 hover:border-gray-300'
              }`}
            >
              <p className="text-xs uppercase tracking-wider text-gray-400 mb-1.5">
                {area === 'all' ? 'Used the app' : `Used ${AREA_LABELS[area].toLowerCase()}`}
              </p>
              <p className="text-4xl font-bold text-green-800 tabular-nums">
                {report.summary.adoptionRate}%
              </p>
              <p className="text-xs text-gray-400 mt-1.5">
                {report.summary.usedApp} of {report.summary.totalMembers} members ·{' '}
                {RANGE_LABELS[range].toLowerCase()}
              </p>
              {/* Meter: the unfilled track is a lighter step of the same ramp. */}
              <div className="mt-3 h-2 rounded-full overflow-hidden" style={{ background: '#DDE5F5' }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${report.summary.adoptionRate}%`, background: '#003385' }}
                />
              </div>
            </button>

            {/* Each tile filters the roster to the members behind its number.
                Reading "18 never signed in" and then having to find the right
                dropdown to see who they are is the wrong way round. */}
            <div className="grid grid-cols-3 gap-2 sm:gap-3 lg:col-span-2">
              <MiniStat
                label="Dormant"
                value={report.summary.dormant}
                sub={area === 'all' ? 'Signed in before, nothing since' : `No ${AREA_LABELS[area].toLowerCase()} activity`}
                active={engagement === 'dormant'}
                onClick={() => setEngagement(engagement === 'dormant' ? 'all' : 'dormant')}
              />
              <MiniStat
                label="Never signed in"
                value={report.summary.neverSignedIn}
                sub="No sign-in on record"
                tone="warn"
                active={engagement === 'never'}
                onClick={() => setEngagement(engagement === 'never' ? 'all' : 'never')}
              />
              <MiniStat
                label="Actions"
                value={report.summary.actionEvents}
                sub={`of ${report.summary.totalEvents} events`}
              />
            </div>
          </div>

          {/* ---- The four focus areas ------------------------ */}
          <p className="text-xs uppercase tracking-widest text-gray-400 mt-6 mb-2">
            Reach by area — tap to filter
          </p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            {focusAreas.map(stat => {
              const isActive = area === stat.area
              const reach = report.summary.totalMembers
                ? Math.round((stat.uniqueMembers / report.summary.totalMembers) * 100)
                : 0
              return (
                <button
                  key={stat.area}
                  onClick={() => setArea(isActive ? 'all' : (stat.area as ActivityArea))}
                  aria-pressed={isActive}
                  className={`text-left bg-white rounded-xl border p-4 sm:p-5 shadow-sm transition-colors ${
                    isActive ? 'border-green-700 ring-1 ring-green-700/20' : 'border-gray-100 hover:border-gray-300'
                  }`}
                >
                  <p className="text-xs uppercase tracking-wider text-gray-400 mb-1.5">{stat.label}</p>
                  <p className="text-2xl sm:text-3xl font-bold text-green-800 tabular-nums">
                    {stat.uniqueMembers}
                  </p>
                  <div className="mt-2.5 h-1.5 rounded-full overflow-hidden" style={{ background: '#DDE5F5' }}>
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${reach}%`, background: '#1A55AD' }}
                    />
                  </div>
                  <p className="text-xs text-gray-400 mt-2 leading-snug">
                    {reach}% reach · {stat.viewEvents} visit{stat.viewEvents === 1 ? '' : 's'} ·{' '}
                    {stat.actionEvents} action{stat.actionEvents === 1 ? '' : 's'}
                  </p>
                </button>
              )
            })}
          </div>

          {/* ---- Trend --------------------------------------- */}
          <AdminCard title="Activity over time">
            <ActivityCharts daily={report.daily} />
          </AdminCard>

          {/* ---- Everything outside the four ----------------- */}
          {otherAreas.length > 0 && (
            <div className="mt-6">
              <AdminCard title="Other areas">
                <div className="space-y-2.5">
                  {otherAreas.map(stat => (
                    // Label above the bar on a phone; the three-column row only
                    // fits once there's width for it.
                    <div key={stat.area} className="sm:flex sm:items-center sm:gap-3">
                      <div className="flex items-baseline justify-between gap-3 mb-1 sm:mb-0 sm:w-40 sm:flex-shrink-0">
                        <span className="text-sm text-gray-700 truncate">{stat.label}</span>
                        <span className="text-xs font-medium text-gray-500 sm:hidden">
                          {stat.uniqueMembers} member{stat.uniqueMembers === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className="flex-1 h-2 rounded-full overflow-hidden min-w-0" style={{ background: '#DDE5F5' }}>
                        <div
                          className="h-full rounded-full"
                          style={{
                            background: '#1A55AD',
                            width: `${Math.round(
                              (stat.totalEvents / Math.max(...report.areas.map(a => a.totalEvents), 1)) * 100
                            )}%`,
                          }}
                        />
                      </div>
                      <span className="hidden sm:block text-xs font-medium text-gray-500 w-28 text-right flex-shrink-0">
                        {stat.uniqueMembers} member{stat.uniqueMembers === 1 ? '' : 's'}
                      </span>
                    </div>
                  ))}
                </div>
              </AdminCard>
            </div>
          )}

          {/* ---- Member roster ------------------------------- */}
          <div className="mt-8 mb-3 flex flex-col gap-2 lg:flex-row lg:items-center">
            <h2 className="text-sm font-semibold text-gray-800 lg:mr-2 whitespace-nowrap">
              Members
              {pagination && pagination.total > 0 && (
                <span className="ml-2 font-normal text-gray-400">
                  {firstRow}–{lastRow} of {pagination.total}
                </span>
              )}
            </h2>

            <input
              type="search"
              placeholder="Search name or email…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full lg:flex-1 lg:min-w-[200px] px-4 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-green-500"
            />

            <div className="grid grid-cols-2 lg:flex gap-2">
              <Select
                options={ENGAGEMENT_OPTIONS}
                value={engagement}
                onChange={next => setEngagement(next as Engagement)}
                className="lg:w-52"
                triggerClassName={TRIGGER_CLASS}
              />

              <Select
                options={SORT_OPTIONS}
                value={sort}
                onChange={next => setSort(next as Sort)}
                className="lg:w-48"
                triggerClassName={TRIGGER_CLASS}
              />

              {/* Full width below lg: the two-column grid would otherwise
                  leave it a hole for a neighbour, since Export spans both. */}
              <Select
                options={tagOptions}
                value={tag}
                onChange={setTag}
                searchPlaceholder="Search GHL tags…"
                className="col-span-2 lg:col-span-1 lg:w-48"
                triggerClassName={TRIGGER_CLASS}
              />

              <button
                onClick={exportCsv}
                disabled={exporting}
                className="col-span-2 lg:col-span-1 px-3 py-2 text-sm font-medium rounded-xl bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors whitespace-nowrap disabled:opacity-50"
              >
                {exporting ? 'Exporting…' : 'Export CSV'}
              </button>
            </div>
          </div>

          {/* Nine columns don't survive a phone. Above md the table is the
              denser, more comparable read; below it, one card per member. */}
          <div className="hidden md:block">
            <AdminTable
              headers={[
                'Member', 'Status', 'Last sign-in', 'Last activity',
                'Calendars', 'Promotions', 'Announcements', 'Directory', 'Total',
              ]}
              empty={report.members.length === 0 ? 'No members match these filters.' : undefined}
            >
              {report.members.map(member => (
                <AdminTr key={member.memberId} onClick={() => setSelected(member)}>
                  <AdminTd>
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 truncate">
                        {member.name}
                        {member.isAdmin && <span className="ml-2 text-xs text-gray-400">admin</span>}
                      </p>
                      <p className="text-xs text-gray-400 truncate">{member.email}</p>
                    </div>
                  </AdminTd>
                  <AdminTd>
                    <Badge
                      label={member.status}
                      colour={
                        member.status === 'active' ? 'green'
                        : member.status === 'suspended' || member.status === 'cancelled' ? 'red'
                        : 'gray'
                      }
                    />
                  </AdminTd>
                  <AdminTd className="text-xs">
                    {member.lastSignIn
                      ? formatDistanceToNow(new Date(member.lastSignIn), { addSuffix: true })
                      : <span className="text-red-500">Never</span>}
                  </AdminTd>
                  <AdminTd className="text-xs">
                    {member.lastEventAt
                      ? formatDistanceToNow(new Date(member.lastEventAt), { addSuffix: true })
                      : <span className="text-gray-300">—</span>}
                  </AdminTd>
                  <AreaCell value={member.calendars} />
                  <AreaCell value={member.promotions} />
                  <AreaCell value={member.announcements} />
                  <AreaCell value={member.directory} />
                  <AdminTd className="font-medium text-gray-900 tabular-nums">
                    {member.totalEvents}
                    {member.actionEvents > 0 && (
                      <span className="text-xs text-gray-400 font-normal"> · {member.actionEvents} act</span>
                    )}
                  </AdminTd>
                </AdminTr>
              ))}
            </AdminTable>
          </div>

          <ul className="md:hidden space-y-2">
            {report.members.length === 0 && (
              <li className="bg-white rounded-xl border border-gray-100 px-4 py-8 text-center text-sm text-gray-400 italic">
                No members match these filters.
              </li>
            )}
            {report.members.map(member => (
              <li key={member.memberId}>
                <button
                  type="button"
                  onClick={() => setSelected(member)}
                  className="w-full text-left bg-white rounded-xl border border-gray-100 shadow-sm p-4 active:bg-gray-50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 truncate">
                        {member.name}
                        {member.isAdmin && <span className="ml-2 text-xs text-gray-400">admin</span>}
                      </p>
                      <p className="text-xs text-gray-400 truncate">{member.email}</p>
                    </div>
                    <Badge
                      label={member.status}
                      colour={
                        member.status === 'active' ? 'green'
                        : member.status === 'suspended' || member.status === 'cancelled' ? 'red'
                        : 'gray'
                      }
                    />
                  </div>

                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    <span className="text-gray-500">
                      Signed in{' '}
                      {member.lastSignIn ? (
                        <span className="text-gray-700">
                          {formatDistanceToNow(new Date(member.lastSignIn), { addSuffix: true })}
                        </span>
                      ) : (
                        <span className="text-red-500 font-medium">never</span>
                      )}
                    </span>
                    {member.lastEventAt && (
                      <span className="text-gray-500">
                        Active{' '}
                        <span className="text-gray-700">
                          {formatDistanceToNow(new Date(member.lastEventAt), { addSuffix: true })}
                        </span>
                      </span>
                    )}
                  </div>

                  {/* Only the areas they actually touched — a row of four
                      zeroes is noise on a screen this size. */}
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    {([
                      ['Calendars', member.calendars],
                      ['Promotions', member.promotions],
                      ['Announcements', member.announcements],
                      ['Directory', member.directory],
                    ] as const)
                      .filter(([, count]) => count > 0)
                      .map(([label, count]) => (
                        <span
                          key={label}
                          className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600"
                        >
                          {label} {count}
                        </span>
                      ))}
                    {member.totalEvents === 0 && (
                      <span className="text-[11px] text-gray-400 italic">No activity in this window</span>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>

          {/* ---- Paging -------------------------------------- */}
          {pagination && pagination.total > 0 && (
            <div className="mt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <Select
                options={PAGE_SIZE_OPTIONS}
                value={String(pageSize)}
                onChange={next => setPageSize(Number(next) as PageSize)}
                className="w-full sm:w-40"
                triggerClassName={TRIGGER_CLASS}
              />

              <div className="flex items-center justify-between sm:justify-end gap-1">
                <PageButton
                  label="Previous"
                  disabled={pagination.page <= 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                />
                <span className="px-3 text-xs text-gray-500 tabular-nums whitespace-nowrap">
                  Page {pagination.page} of {pagination.totalPages}
                </span>
                <PageButton
                  label="Next"
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => setPage(p => p + 1)}
                />
              </div>
            </div>
          )}

          {/* ---- Site-wide feed ------------------------------ */}
          <div className="mt-8">
            <AdminCard title="Recent activity">
              {/* Ten, then "Load older activity" — this sits at the bottom of
                  an already long page, and its job is to show what just
                  happened, not to be scrolled through. */}
              <ActivityFeed query={feedQuery} pageSize={10} />
            </AdminCard>
          </div>
        </div>
      ) : null}

      {/* ---- Per-member trail ---------------------------- */}
      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/20" onClick={() => setSelected(null)} aria-hidden />
          <aside className="relative w-full sm:max-w-md bg-white h-full overflow-y-auto shadow-xl">
            <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-semibold text-gray-900 truncate">{selected.name}</h2>
                <p className="text-xs text-gray-400 truncate">{selected.email}</p>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="text-gray-400 hover:text-gray-600 text-sm px-2"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="px-5 py-4 grid grid-cols-2 gap-3 text-sm border-b border-gray-100">
              <Fact label="Last sign-in" value={selected.lastSignIn ? formatDistanceToNow(new Date(selected.lastSignIn), { addSuffix: true }) : 'Never'} />
              <Fact label="Last activity" value={selected.lastEventAt ? formatDistanceToNow(new Date(selected.lastEventAt), { addSuffix: true }) : 'None recorded'} />
              <Fact label="Visits" value={String(selected.viewEvents)} />
              <Fact label="Actions" value={String(selected.actionEvents)} />
              <Fact label="Course" value={selected.courseName ?? 'None'} />
              <Fact label="Member since" value={format(new Date(selected.joinedAt), 'd MMM yyyy')} />
            </div>

            <div className="px-5 py-4">
              <p className="text-xs uppercase tracking-widest text-gray-400 mb-3">Activity trail</p>
              <ActivityFeed
                query={`${feedQuery}&memberId=${selected.memberId}`}
                showMember={false}
                emptyLabel="Nothing recorded for this member in this window."
                pageSize={30}
              />
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}

function MiniStat({
  label,
  value,
  sub,
  tone = 'neutral',
  active = false,
  onClick,
}: {
  label: string
  value: number
  sub: string
  tone?: 'neutral' | 'warn'
  active?: boolean
  onClick?: () => void
}) {
  const body = (
    <>
      {/* Two lines reserved: "Never signed in" wraps at phone width, and
          without the reserve its number sits lower than its neighbours'. */}
      <p className="text-[10px] sm:text-xs uppercase tracking-wider text-gray-400 mb-1.5 leading-tight min-h-[2.4em] sm:min-h-0">
        {label}
      </p>
      <p className={`text-xl sm:text-3xl font-bold tabular-nums ${tone === 'warn' ? 'text-red-600' : 'text-gray-800'}`}>
        {value}
      </p>
      {/* The caption is the first thing to go on a narrow screen — the label
          and the number carry the meaning on their own. */}
      <p className="hidden sm:block text-xs text-gray-400 mt-1.5 leading-snug">{sub}</p>
    </>
  )

  const shell = 'rounded-xl border p-3 sm:p-5 shadow-sm bg-white transition-colors'

  if (!onClick) {
    return <div className={`${shell} border-gray-100`}>{body}</div>
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`text-left ${shell} ${
        active ? 'border-green-700 ring-1 ring-green-700/20' : 'border-gray-100 hover:border-gray-300'
      }`}
    >
      {body}
    </button>
  )
}

function PageButton({
  label,
  disabled,
  onClick,
}: {
  label: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="px-4 py-2 text-xs font-medium rounded-lg bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-white transition-colors"
    >
      {label}
    </button>
  )
}

/** Zero reads as "hasn't touched this area", so it's greyed rather than bold. */
function AreaCell({ value }: { value: number }) {
  return <AdminTd className={value > 0 ? 'text-gray-700 tabular-nums' : 'text-gray-300 tabular-nums'}>{value}</AdminTd>
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-gray-400">{label}</p>
      <p className="text-sm text-gray-700 mt-0.5">{value}</p>
    </div>
  )
}
