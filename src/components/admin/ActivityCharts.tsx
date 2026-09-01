'use client'

// ============================================================
// The two trend charts on the usage report.
//
// Small multiples sharing one x-axis rather than one chart with
// two y-scales: events and people are different units, and
// pinning them to a common axis would invent a correlation the
// data doesn't contain. `syncId` ties the two hovers together so
// they still read as one figure.
//
// Palette is the brand's own, validated for colour-vision
// deficiency and surface contrast before use:
//   visits  #5588CC  ┐ one hue, light → dark. Visits → actions is
//   actions #003385  ┘ an engagement order, so it's an ordinal
//                      ramp, not two arbitrary identities.
//   members #639948    the accent, a different measure entirely.
// ============================================================

import { useEffect, useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { format } from 'date-fns'

export interface DailyPoint {
  day: string
  totalEvents: number
  actionEvents: number
  activeMembers: number
}

/** Narrow screens get fewer ticks, shorter plots and a tighter axis gutter —
 *  the same chart at 360px with 8 date labels is an unreadable smear. */
function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(false)

  useEffect(() => {
    const query = window.matchMedia('(max-width: 639px)')
    const sync = () => setNarrow(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])

  return narrow
}

const VISITS  = '#5588CC'
const ACTIONS = '#003385'
const MEMBERS = '#639948'
const GRID    = '#EEF2FA'
const AXIS    = '#9CA3AF'
const SURFACE = '#FFFFFF'

/** Bars cap at 24px and never fill their band — the leftover is air. */
const MAX_BAR = 24
/** The surface gap that separates touching marks, in px. */
const GAP = 2

interface Row extends DailyPoint {
  visitEvents: number
  label: string
}

/** A column with a rounded data-end and a square base. `rx` on a <rect> would
 *  round all four corners, which turns a stacked segment into a floating pill
 *  and detaches the bottom one from its baseline. */
function columnPath(x: number, y: number, width: number, height: number, radius: number): string {
  const r = Math.max(0, Math.min(radius, width / 2, height))
  if (r === 0) return `M${x},${y}h${width}v${height}h${-width}Z`
  return [
    `M${x},${y + r}`,
    `a${r},${r} 0 0 1 ${r},${-r}`,
    `h${width - 2 * r}`,
    `a${r},${r} 0 0 1 ${r},${r}`,
    `v${height - r}`,
    `h${-width}`,
    'Z',
  ].join('')
}

/** Bars cap at MAX_BAR and centre in their band — the leftover is air, never
 *  a fatter mark. */
function bandGeometry(x: number, width: number): { left: number; capped: number } {
  const capped = Math.min(width, MAX_BAR)
  return { left: x + (width - capped) / 2, capped }
}

/** Bottom segment. Ends 2px short when something sits on top of it, so the
 *  separation is a gap in the surface rather than a stroke around the mark. */
function VisitsShape(props: unknown) {
  const { x, y, width, height, payload } = props as {
    x: number; y: number; width: number; height: number; payload: Row
  }
  if (height <= 0) return <g />

  const { left, capped } = bandGeometry(x, width)
  const stacked = payload.actionEvents > 0
  const top = stacked ? y + GAP : y
  const tall = stacked ? height - GAP : height
  if (tall <= 0) return <g />

  // Rounded only when this segment is the data end — a 4px cap in the middle
  // of a stack would read as two separate bars.
  return <path d={columnPath(left, top, capped, tall, stacked ? 0 : 4)} fill={VISITS} />
}

/** Top segment: always the data end, so always the 4px rounded cap. */
function ActionsShape(props: unknown) {
  const { x, y, width, height } = props as { x: number; y: number; width: number; height: number }
  if (height <= 0) return <g />

  const { left, capped } = bandGeometry(x, width)
  return <path d={columnPath(left, y, capped, height, 4)} fill={ACTIONS} />
}

/** One readout for every series at that day — the pointer never has to land on
 *  a specific mark to get a number. Values lead, labels follow. */
function ActivityTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload: Row }>
}) {
  const row = active ? payload?.[0]?.payload : undefined
  if (!row) return null

  const lines: Array<{ colour: string; label: string; value: number }> = [
    { colour: ACTIONS, label: 'Actions', value: row.actionEvents },
    { colour: VISITS,  label: 'Visits',  value: row.visitEvents },
    { colour: MEMBERS, label: 'Members active', value: row.activeMembers },
  ]

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-lg px-3 py-2.5 text-xs">
      <p className="font-medium text-gray-900 mb-1.5">
        {format(new Date(`${row.day}T12:00:00`), 'EEE d MMM yyyy')}
      </p>
      {lines.map(line => (
        <p key={line.label} className="flex items-center gap-2 leading-6">
          <span
            className="inline-block w-3 h-0.5 rounded-full flex-shrink-0"
            style={{ background: line.colour }}
            aria-hidden
          />
          <span className="font-semibold text-gray-900 tabular-nums">{line.value}</span>
          <span className="text-gray-500">{line.label}</span>
        </p>
      ))}
    </div>
  )
}

/** The one direct label on the line: its end point. A number on every day
 *  would be unreadable, and the axis plus the table carry the rest. */
function EndPointLabel(lastIndex: number) {
  function Label(props: unknown) {
    const { x, y, value, index } = props as {
      x: number; y: number; value: number; index: number
    }
    if (index !== lastIndex) return <g />
    return (
      <g>
        {/* r=4 is an 8px marker; the 2px surface ring keeps it legible where
            it sits on the line. */}
        <circle cx={x} cy={y} r={4} fill={MEMBERS} stroke={SURFACE} strokeWidth={2} />
        <text
          x={x - 8}
          y={y - 10}
          textAnchor="end"
          // Text wears a text token, never the series colour.
          fill="#4B5563"
          fontSize={11}
          fontWeight={600}
        >
          {value}
        </text>
      </g>
    )
  }
  return Label
}

export default function ActivityCharts({ daily }: { daily: DailyPoint[] }) {
  const narrow = useIsNarrow()

  const rows: Row[] = useMemo(
    () =>
      daily.map(point => ({
        ...point,
        // The API sends the total; the stack needs the visits remainder.
        visitEvents: Math.max(0, point.totalEvents - point.actionEvents),
        label: format(new Date(`${point.day}T12:00:00`), 'd MMM'),
      })),
    [daily]
  )

  if (!rows.length) {
    return (
      <p className="text-sm text-gray-400 italic py-10 text-center">
        No activity recorded in this window yet.
      </p>
    )
  }

  // Enough ticks to orient without crowding the axis.
  const tickGap = Math.max(1, Math.ceil(rows.length / (narrow ? 3 : 8)))
  const ticks = rows.filter((_, i) => i % tickGap === 0).map(row => row.label)

  const axisProps = {
    tick: { fill: AXIS, fontSize: narrow ? 10 : 11 },
    tickLine: false,
    axisLine: { stroke: GRID },
  } as const

  // The negative left margin reclaims Recharts' default gutter, but only where
  // there's room for it — at phone width it clips three-digit y labels.
  const axisWidth = narrow ? 34 : 44
  const margin = { top: 4, right: narrow ? 10 : 4, bottom: 0, left: narrow ? 0 : -12 }

  return (
    <div className="space-y-6">
      {/* ---- Events per day ------------------------------- */}
      <figure className="m-0">
        <figcaption className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <h3 className="text-sm font-semibold text-gray-800">Events per day</h3>
          {/* Two series, so a legend is always present — identity is never
              left to colour-matching alone. */}
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: ACTIONS }} aria-hidden />
              Actions
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: VISITS }} aria-hidden />
              Visits
            </span>
          </div>
        </figcaption>

        <ResponsiveContainer width="100%" height={narrow ? 160 : 190}>
          <BarChart
            data={rows}
            syncId="activity"
            margin={margin}
            // px, not a percentage: the same 2px surface gap that separates the
            // stacked segments, held constant however many days are in range.
            barCategoryGap={GAP}
          >
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="label" ticks={ticks} interval={0} {...axisProps} />
            <YAxis allowDecimals={false} width={axisWidth} {...axisProps} />
            <Tooltip
              content={<ActivityTooltip />}
              cursor={{ fill: GRID, fillOpacity: 0.6 }}
            />
            {/* barCategoryGap in px: the same 2px surface gap that separates
                the stacked segments also separates neighbouring columns. */}
            <Bar dataKey="visitEvents"  stackId="events" shape={VisitsShape}  isAnimationActive={false} />
            <Bar dataKey="actionEvents" stackId="events" shape={ActionsShape} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </figure>

      {/* ---- People per day ------------------------------- */}
      <figure className="m-0">
        <figcaption className="mb-3">
          {/* One series, so no legend box — the title already names it. */}
          <h3 className="text-sm font-semibold text-gray-800">Members active per day</h3>
        </figcaption>

        <ResponsiveContainer width="100%" height={narrow ? 125 : 150}>
          <AreaChart data={rows} syncId="activity" margin={margin}>
            <defs>
              <linearGradient id="membersWash" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor={MEMBERS} stopOpacity={0.18} />
                <stop offset="100%" stopColor={MEMBERS} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="label" ticks={ticks} interval={0} {...axisProps} />
            <YAxis allowDecimals={false} width={axisWidth} {...axisProps} />
            {/* syncId fires both charts' tooltips at once, so this one draws
                the crosshair and renders no box — one readout for the figure,
                not the same three numbers twice. */}
            <Tooltip content={() => null} cursor={{ stroke: AXIS, strokeWidth: 1 }} />
            <Area
              // linear, not monotone: these are daily counts, and a smoothed
              // curve invents values between days that were never measured.
              type="linear"
              dataKey="activeMembers"
              stroke={MEMBERS}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              fill="url(#membersWash)"
              dot={false}
              activeDot={{ r: 4, fill: MEMBERS, stroke: SURFACE, strokeWidth: 2 }}
              isAnimationActive={false}
            >
              <LabelList dataKey="activeMembers" content={EndPointLabel(rows.length - 1)} />
            </Area>
          </AreaChart>
        </ResponsiveContainer>
      </figure>

      {/* Every value in the charts is reachable without hovering. */}
      <details className="text-sm">
        <summary className="cursor-pointer text-xs font-medium text-gray-500 hover:text-gray-700">
          View as table
        </summary>
        <div className="mt-3 max-h-64 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-gray-100 text-gray-400">
                <th scope="col" className="text-left font-medium py-1.5">Day</th>
                <th scope="col" className="text-right font-medium py-1.5">Visits</th>
                <th scope="col" className="text-right font-medium py-1.5">Actions</th>
                <th scope="col" className="text-right font-medium py-1.5">Members</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.day} className="border-b border-gray-50 last:border-0">
                  <td className="py-1.5 text-gray-600">{row.label}</td>
                  <td className="py-1.5 text-right tabular-nums text-gray-700">{row.visitEvents}</td>
                  <td className="py-1.5 text-right tabular-nums text-gray-700">{row.actionEvents}</td>
                  <td className="py-1.5 text-right tabular-nums text-gray-700">{row.activeMembers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
