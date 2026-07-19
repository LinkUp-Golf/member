'use client'

import { useState, useEffect, useCallback } from 'react'
import { AdminPageHeader, StatCard, AdminCard, Badge } from '@/components/admin/AdminUI'
import { formatPeriod } from '@/lib/referral-rate'

const fmtMoney = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

interface PayoutPeriod {
  periodMonth: string
  conversions: Array<{ linkId: string; email: string; name: string | null; convertedAt: string; commission: number }>
  total: number
  paid: boolean
  paidAmount: number | null
  paidAt: string | null
}

interface PaymentsResponse {
  periods: PayoutPeriod[]
  totalPaid: number
  totalOutstanding: number
}

export default function PartnerPaymentsPage() {
  const [data, setData] = useState<PaymentsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/partner/payments')
    const json = await res.json().catch(() => ({}))
    if (res.ok) setData(json)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <div className="p-8 text-sm text-gray-400">Loading…</div>
  if (!data) return <div className="p-8 text-sm text-red-500">Could not load your payments.</div>

  const { periods, totalPaid, totalOutstanding } = data

  return (
    <div className="p-4 sm:p-8">
      <AdminPageHeader
        title="Payments"
        description="Your commission by month. Payouts are made manually by the LinkUp team."
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
        <StatCard label="Paid to date"  value={fmtMoney(totalPaid)}        sub="Across all months" colour="green" />
        <StatCard label="Outstanding"   value={fmtMoney(totalOutstanding)} sub="Awaiting payout"   colour="gold" />
        <StatCard label="Months earned" value={periods.length}             sub="With commission"   colour="blue" />
      </div>

      <AdminCard title="Payment History">
        {periods.length === 0 ? (
          <p className="text-sm text-gray-400 italic py-4 text-center">
            No commission earned yet. It appears here the month a referral becomes a paying member.
          </p>
        ) : (
          <div className="divide-y divide-gray-50">
            {periods.map(p => {
              const isOpen = expanded === p.periodMonth
              return (
                <div key={p.periodMonth} className="py-3">
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : p.periodMonth)}
                    className="w-full flex items-center justify-between gap-3 text-left"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800">{formatPeriod(p.periodMonth)}</p>
                      <p className="text-xs text-gray-400">
                        {p.conversions.length} referral{p.conversions.length !== 1 ? 's' : ''} converted
                        {p.paid && p.paidAt ? ` · paid ${fmtDate(p.paidAt)}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-sm font-medium text-gray-900">
                        {fmtMoney(p.paid && p.paidAmount !== null ? p.paidAmount : p.total)}
                      </span>
                      <Badge label={p.paid ? 'Paid' : 'Pending'} colour={p.paid ? 'green' : 'gold'} />
                    </div>
                  </button>

                  {isOpen && p.conversions.length > 0 && (
                    <div className="mt-3 ml-1 pl-3 border-l border-gray-100 space-y-2">
                      {p.conversions.map(c => (
                        <div key={c.linkId} className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs text-gray-600 truncate">{c.name ?? c.email}</p>
                            <p className="text-[11px] text-gray-400">Joined {fmtDate(c.convertedAt)}</p>
                          </div>
                          <span className="text-xs text-gray-500 flex-shrink-0">{fmtMoney(c.commission)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </AdminCard>
    </div>
  )
}
