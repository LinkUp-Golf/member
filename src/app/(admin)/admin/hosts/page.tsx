'use client'

// Admin Hosts: the host roster, host applications, and event/credit review —
// all on one page as tabs, mirroring the admin Referral Partners page.

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { AdminPageHeader, AdminTable, AdminTr, AdminTd, Badge } from '@/components/admin/AdminUI'
import HostApplications from '@/components/admin/HostApplications'
import HostedEventsAdmin from '@/components/admin/HostedEventsAdmin'
import type { HostCreditSummary } from '@/types'

const fmtMoney = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 })

type Tab = 'hosts' | 'applications' | 'events'

interface AdminHostRow {
  id: string
  name: string
  status: string
  created_at: string
  member?: { first_name: string; last_name: string; email: string } | null
  credits: HostCreditSummary
  event_count: number
}

export default function AdminHostsPage() {
  const [tab, setTab] = useState<Tab>('hosts')
  const [hosts, setHosts] = useState<AdminHostRow[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  const showToast = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok }); setTimeout(() => setToast(null), 3500)
  }, [])

  const loadHosts = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/admin/hosts')
    const json = await res.json().catch(() => ({}))
    if (res.ok) setHosts(Array.isArray(json.hosts) ? json.hosts : [])
    else showToast(json.error ?? 'Failed to load hosts.', false)
    setLoading(false)
  }, [showToast])

  useEffect(() => { if (tab === 'hosts') loadHosts() }, [tab, loadHosts])

  const memberName = (h: AdminHostRow) =>
    h.member ? `${h.member.first_name} ${h.member.last_name}`.trim() : '—'

  const TABS: { key: Tab; label: string }[] = [
    { key: 'hosts', label: 'Hosts' },
    { key: 'applications', label: 'Applications' },
    { key: 'events', label: 'Events & Credits' },
  ]

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
          <AdminTable
            headers={['Host', 'Member', 'Events', 'Balance', '']}
            empty={hosts.length === 0 ? 'No hosts yet.' : undefined}
          >
            {hosts.map(h => (
              <AdminTr key={h.id}>
                <AdminTd className="font-medium text-gray-900">
                  <span className="flex items-center gap-2">
                    {h.name}
                    {h.status === 'suspended' && <Badge label="Suspended" colour="red" />}
                  </span>
                </AdminTd>
                <AdminTd>
                  <span className="block">{memberName(h)}</span>
                  <span className="block text-xs text-gray-400">{h.member?.email}</span>
                </AdminTd>
                <AdminTd>{h.event_count}</AdminTd>
                <AdminTd className="font-medium">{fmtMoney(h.credits.balance)}</AdminTd>
                <AdminTd className="text-right">
                  <Link href={`/admin/hosts/${h.id}`} className="text-xs font-medium text-gray-500 hover:text-green-800 px-2 py-1">
                    Manage
                  </Link>
                </AdminTd>
              </AdminTr>
            ))}
          </AdminTable>
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
