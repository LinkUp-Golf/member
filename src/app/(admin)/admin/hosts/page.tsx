'use client'

// Admin Hosts: the host roster, host applications, and event/credit review —
// all on one page as tabs, mirroring the admin Referral Partners page.

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { AdminPageHeader, AdminTable, AdminTr, AdminTd, Badge } from '@/components/admin/AdminUI'
import HostApplications from '@/components/admin/HostApplications'
import HostedEventsAdmin from '@/components/admin/HostedEventsAdmin'
import { errorMessage } from '@/lib/errors/error-message'
import type { CreditSummary } from '@/types'

const fmtMoney = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 })

type Tab = 'hosts' | 'applications' | 'events'

// Module-level so the array isn't rebuilt on every render.
const TABS: { key: Tab; label: string }[] = [
  { key: 'hosts', label: 'Hosts' },
  { key: 'applications', label: 'Applications' },
  { key: 'events', label: 'Events & Credits' },
]

interface AdminHostRow {
  id: string
  name: string
  status: string
  source?: string
  venues_unrestricted?: boolean
  created_at: string
  member?: { first_name: string; last_name: string; email: string } | null
  credits: CreditSummary
  event_count: number
}

type StatusFilter = 'all' | 'active' | 'suspended'

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'suspended', label: 'Suspended' },
]

export default function AdminHostsPage() {
  const [tab, setTab] = useState<Tab>('hosts')
  const [hosts, setHosts] = useState<AdminHostRow[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [busyId, setBusyId] = useState<string | null>(null)

  const showToast = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok }); setTimeout(() => setToast(null), 3500)
  }, [])

  const loadHosts = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/hosts')
      const json = await res.json().catch(() => ({}))
      if (res.ok) setHosts(Array.isArray(json.hosts) ? json.hosts : [])
      else showToast(errorMessage(json, 'Failed to load hosts.'), false)
    } catch {
      // Without this the throw skipped setLoading(false) and pinned the page on
      // "Loading…" with no way back.
      showToast('Failed to load hosts.', false)
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => { if (tab === 'hosts') loadHosts() }, [tab, loadHosts])

  const memberName = (h: AdminHostRow) =>
    h.member ? `${h.member.first_name} ${h.member.last_name}`.trim() : '—'

  const setHostStatus = async (h: AdminHostRow, status: 'active' | 'suspended') => {
    if (busyId) return
    if (status === 'suspended' && !window.confirm(
      `Suspend ${h.name}? They lose the host workspace and their upcoming events stop being listed. Existing reservations are kept.`
    )) return

    setBusyId(h.id)
    try {
      const res = await fetch(`/api/admin/hosts/${h.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { showToast(errorMessage(json, 'Could not update the host.'), false); return }
      showToast(status === 'suspended' ? `${h.name} suspended.` : `${h.name} reactivated.`)
      loadHosts()
    } catch {
      showToast('Could not update the host.', false)
    } finally {
      setBusyId(null)
    }
  }

  const counts = hosts.reduce<Record<string, number>>((acc, h) => {
    acc[h.status] = (acc[h.status] ?? 0) + 1
    return acc
  }, {})

  const term = search.trim().toLowerCase()
  const visibleHosts = hosts.filter(h => {
    if (statusFilter !== 'all' && h.status !== statusFilter) return false
    if (!term) return true
    return [h.name, memberName(h), h.member?.email ?? '']
      .some(v => v.toLowerCase().includes(term))
  })

  return (
    <div className="p-4 sm:p-8">
      <AdminPageHeader title="Hosts" description="Members who run their own events, their applications, and credit approvals." />

      <div className="flex gap-1 border-b border-gray-100 mb-6">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key ? 'border-green-900 text-green-900' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'hosts' && (
        loading ? (
          <div className="py-16 text-center text-sm text-gray-400">Loading…</div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <input
                type="search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search host, member or email"
                className="flex-1 min-w-[220px] px-3 py-2 text-sm rounded-xl border border-gray-200 focus:border-green-700 outline-none transition-colors"
              />
              <div className="flex gap-1">
                {STATUS_FILTERS.map(f => {
                  const count = f.key === 'all' ? hosts.length : (counts[f.key] ?? 0)
                  return (
                    <button
                      key={f.key}
                      onClick={() => setStatusFilter(f.key)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                        statusFilter === f.key
                          ? 'bg-green-900 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {f.label} ({count})
                    </button>
                  )
                })}
              </div>
            </div>

            <AdminTable
              headers={['Host', 'Member', 'Events', 'Balance', '']}
              empty={
                visibleHosts.length === 0
                  ? (hosts.length === 0 ? 'No hosts yet.' : 'No hosts match that filter.')
                  : undefined
              }
            >
              {visibleHosts.map(h => (
                <AdminTr key={h.id}>
                  <AdminTd className="font-medium text-gray-900">
                    <span className="flex flex-wrap items-center gap-1.5">
                      {h.name}
                      {h.status === 'suspended' && <Badge label="Suspended" colour="red" />}
                      {/* Provenance: a host auto-provisioned from the GHL tag never
                          went through review, which is worth seeing on the roster. */}
                      {h.source === 'ghl_tag' && <Badge label="GHL tag" colour="yellow" />}
                      {h.venues_unrestricted && <Badge label="All venues" colour="blue" />}
                    </span>
                  </AdminTd>
                  <AdminTd>
                    <span className="block">{memberName(h)}</span>
                    <span className="block text-xs text-gray-400">{h.member?.email}</span>
                  </AdminTd>
                  <AdminTd>{h.event_count}</AdminTd>
                  <AdminTd className="font-medium">{fmtMoney(h.credits.balance)}</AdminTd>
                  <AdminTd className="text-right whitespace-nowrap">
                    <button
                      onClick={() => setHostStatus(h, h.status === 'suspended' ? 'active' : 'suspended')}
                      disabled={busyId === h.id}
                      className={`text-xs font-medium px-2 py-1 disabled:opacity-40 ${
                        h.status === 'suspended'
                          ? 'text-gray-500 hover:text-green-800'
                          : 'text-gray-500 hover:text-red-600'
                      }`}
                    >
                      {h.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                    </button>
                    <Link href={`/admin/hosts/${h.id}`} className="text-xs font-medium text-gray-500 hover:text-green-800 px-2 py-1">
                      Manage
                    </Link>
                  </AdminTd>
                </AdminTr>
              ))}
            </AdminTable>
          </>
        )
      )}

      {tab === 'applications' && (
        <HostApplications onToast={showToast} onReviewed={loadHosts} />
      )}

      {tab === 'events' && (
        <HostedEventsAdmin onToast={showToast} />
      )}

      {toast && (
        <div className={`fixed top-6 right-6 z-[60] px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${toast.ok ? 'bg-green-900 text-white' : 'bg-red-600 text-white'}`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
