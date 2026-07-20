'use client'

// Host dashboard: event statistics and the credit summary at a glance.

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { AdminPageHeader, StatCard, AdminCard } from '@/components/admin/AdminUI'
import type { Host, HostStats } from '@/types'

const fmtMoney = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })

interface OverviewResponse {
  host: Host
  stats: HostStats
}

export default function HostOverviewPage() {
  const [data, setData] = useState<OverviewResponse | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const res = await fetch('/api/host/overview')
    const json = await res.json().catch(() => ({}))
    if (res.ok) setData(json)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="p-4 sm:p-8 max-w-4xl mx-auto">
      <AdminPageHeader
        title="Host Dashboard"
        description={data ? `Hosting as ${data.host.name}` : 'Your events and credits'}
        action={<Link href="/host/events" className="btn btn-gold btn-sm">Manage events</Link>}
      />

      {loading ? (
        <div className="py-16 text-center text-sm text-gray-400">Loading…</div>
      ) : !data ? (
        <div className="py-16 text-center text-sm text-red-500">Could not load your dashboard.</div>
      ) : (
        <>
          <p className="section-label mb-3">Events</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
            <StatCard label="Upcoming"  value={data.stats.upcomingCount}  sub="Open for reservations" colour="green" />
            <StatCard label="Completed" value={data.stats.completedCount} sub="Rounds that ran"        colour="blue" />
            <StatCard label="Cancelled" value={data.stats.cancelledCount} sub="Called off"             colour="gray" />
            <StatCard label="Total"     value={data.stats.totalEvents}    sub="All time"               colour="gold" />
          </div>

          <p className="section-label mb-3">Credits</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCard label="Earned"    value={fmtMoney(data.stats.credits.earned)}   sub="Approved to date" colour="green" />
            <StatCard label="Redeemed"  value={fmtMoney(data.stats.credits.redeemed)} sub="Spent"            colour="gray" />
            <StatCard label="Available" value={fmtMoney(data.stats.credits.balance)}  sub="Balance"          colour="gold" large />
          </div>

          <AdminCard title="How credits work">
            <ul className="text-sm text-gray-600 space-y-2 list-disc pl-5">
              <li>Create an event, then run it on the day.</li>
              <li>Upload proof the event happened from the event&apos;s page.</li>
              <li>An admin reviews your proof and approves the credit — based on your member guest rate.</li>
              <li>Redeem your available balance any time from the Credits tab.</li>
            </ul>
          </AdminCard>
        </>
      )}
    </div>
  )
}
