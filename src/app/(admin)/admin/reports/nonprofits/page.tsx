'use client'

// Which non-profits the membership supports, ranked within each city or
// community. Counting and grouping happen in the RPC behind
// /api/admin/reports/nonprofits — this page renders what it's given.

import { useState, useEffect, useCallback } from 'react'
import { AdminPageHeader, AdminCard, StatCard } from '@/components/admin/AdminUI'
import { ContentLoader } from '@/components/ui/Loading'

type GroupBy = 'city' | 'community'

interface Entry { nonprofit: string; memberCount: number }
interface Group { label: string; total: number; entries: Entry[] }

export default function NonprofitReportPage() {
  const [groupBy, setGroupBy] = useState<GroupBy>('city')
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/admin/reports/nonprofits?groupBy=${groupBy}`)
    const json = await res.json().catch(() => ({}))
    if (res.ok) {
      setError(null)
      setGroups(json.groups ?? [])
    } else {
      // Without this a failed load renders as a confident "no non-profits yet".
      setError(json.error ?? 'Could not load the report.')
    }
    setLoading(false)
  }, [groupBy])

  useEffect(() => { load() }, [load])

  // Distinct non-profits across the whole membership, deduplicated by the same
  // case-insensitive rule the RPC groups by.
  const distinct = new Set(groups.flatMap(g => g.entries.map(e => e.nonprofit.toLowerCase()))).size
  const mentions = groups.reduce((sum, g) => sum + g.total, 0)

  return (
    <div className="p-4 sm:p-8">
      <AdminPageHeader
        title="Non-profits"
        description="What the membership supports, ranked within each city or community."
        action={
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
            {(['city', 'community'] as const).map(option => (
              <button
                key={option}
                onClick={() => setGroupBy(option)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors capitalize ${
                  groupBy === option ? 'bg-white text-green-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                By {option}
              </button>
            ))}
          </div>
        }
      />

      {loading ? (
        <ContentLoader />
      ) : error ? (
        <AdminCard>
          <div className="py-10 text-center">
            <p className="text-sm text-red-500">{error}</p>
            <button onClick={load} className="btn btn-outline btn-sm mt-4">Try again</button>
          </div>
        </AdminCard>
      ) : groups.length === 0 ? (
        <AdminCard>
          <p className="text-sm text-gray-400 italic py-10 text-center">
            No members have listed a non-profit yet.
          </p>
        </AdminCard>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
            <StatCard label="Non-profits" value={String(distinct)} sub="Distinct" colour="green" />
            <StatCard label={groupBy === 'city' ? 'Cities' : 'Communities'} value={String(groups.length)} sub="With support" colour="gray" />
            {/* Mentions, not members: someone supporting three non-profits is
                counted against each of them. Saying "members" here would
                overstate reach. */}
            <div className="col-span-2 sm:col-span-1">
              <StatCard label="Mentions" value={String(mentions)} sub="Across all lists" colour="gold" />
            </div>
          </div>

          <div className="space-y-4">
            {groups.map(group => {
              // Bars are scaled within each group, not globally — the question
              // is which non-profit leads in this city, and a shared scale
              // would flatten every small city against the largest one.
              const top = Math.max(...group.entries.map(e => e.memberCount), 1)
              return (
                <AdminCard key={group.label} title={group.label}>
                  <div className="space-y-2.5">
                    {group.entries.map(entry => (
                      <div key={entry.nonprofit} className="flex items-center gap-3">
                        <span className="text-sm text-gray-700 w-48 sm:w-64 flex-shrink-0 truncate" title={entry.nonprofit}>
                          {entry.nonprofit}
                        </span>
                        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden min-w-0">
                          <div
                            className="h-full rounded-full bg-green-700 transition-all"
                            style={{ width: `${Math.round((entry.memberCount / top) * 100)}%` }}
                          />
                        </div>
                        <span className="text-xs font-medium text-gray-500 w-16 text-right flex-shrink-0">
                          {entry.memberCount} {entry.memberCount === 1 ? 'member' : 'members'}
                        </span>
                      </div>
                    ))}
                  </div>
                </AdminCard>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
