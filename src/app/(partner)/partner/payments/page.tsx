'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { AdminPageHeader, StatCard, AdminCard, Badge } from '@/components/admin/AdminUI'
import { ContentLoader } from '@/components/ui/Loading'
import { COMMISSION_TERM_MONTHS, PAYOUT_METHOD_LABEL } from '@/lib/constants'
import type { PayoutMethod } from '@/types'

const fmtMoney = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

interface MemberAccrual {
  linkId: string
  email: string
  name: string | null
  startDate: string
  endDate: string | null
  months: number
  accrued: number
}

interface Payout {
  id: string
  amount: number
  method: string
  reference: string | null
  note: string | null
  paid_at: string
}

interface Balance {
  totalAccrued: number
  totalPaid: number
  outstanding: number
  payable: boolean
  threshold: number
}

interface PaymentsResponse {
  accruals: MemberAccrual[]
  payouts: Payout[]
  balance: Balance
  monthlyRate: number
}

export default function PartnerPaymentsPage() {
  const [data, setData] = useState<PaymentsResponse | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const res = await fetch('/api/partner/payments')
    const json = await res.json().catch(() => ({}))
    if (res.ok) setData(json)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <ContentLoader />
  if (!data) return <div className="p-8 text-sm text-red-500">Could not load your payments.</div>

  const { accruals, payouts, balance, monthlyRate } = data
  const earning = accruals.filter(a => a.endDate === null)
  const toThreshold = Math.max(0, balance.threshold - balance.outstanding)

  return (
    <div className="p-4 sm:p-8">
      <AdminPageHeader
        title="Payments"
        description={`You earn ${fmtMoney(monthlyRate)} a month for each referred member, for up to ${COMMISSION_TERM_MONTHS} months. The LinkUp team pays out once your balance reaches ${fmtMoney(balance.threshold)}.`}
      />

      <div className="mb-4 rounded-xl border border-gray-100 bg-white px-4 py-3 flex items-center justify-between gap-3">
        <p className="text-xs text-gray-600">
          Commission is paid as LinkUp credit — spend it on golf or toward membership.
        </p>
        <Link href="/partner/credits" className="btn btn-outline btn-sm flex-shrink-0 whitespace-nowrap">
          View credits
        </Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        <StatCard label="Outstanding"  value={fmtMoney(Math.max(0, balance.outstanding))} sub="Awaiting payout"    colour="gold" />
        <StatCard label="Paid to date" value={fmtMoney(balance.totalPaid)}                sub="Across all payouts" colour="green" />
        <StatCard label="Earned to date" value={fmtMoney(balance.totalAccrued)}           sub="All time"           colour="blue" />
      </div>

      <div className="mb-8 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
        <p className="text-xs text-gray-600">
          {balance.payable
            ? `Your balance of ${fmtMoney(balance.outstanding)} is ready — the LinkUp team will pay it out.`
            : `${fmtMoney(toThreshold)} more until your next payout (threshold ${fmtMoney(balance.threshold)}).`}
        </p>
      </div>

      <AdminCard title="Your referred members">
        {accruals.length === 0 ? (
          <p className="text-sm text-gray-400 italic py-4 text-center">
            No commission yet. It starts the month a referral becomes a paying member.
          </p>
        ) : (
          <div className="divide-y divide-gray-50">
            {accruals.map(a => (
              <div key={a.linkId} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{a.name ?? a.email}</p>
                  <p className="text-xs text-gray-400">
                    {a.months} of {COMMISSION_TERM_MONTHS} month{a.months !== 1 ? 's' : ''}
                    {a.endDate ? ' · ended' : ''}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-medium text-gray-900">{fmtMoney(a.accrued)}</p>
                  <Badge label={a.endDate ? 'Ended' : 'Active'} colour={a.endDate ? 'gray' : 'green'} />
                </div>
              </div>
            ))}
          </div>
        )}
        {earning.length > 0 && (
          <p className="pt-3 mt-2 border-t border-gray-50 text-[11px] text-gray-400">
            {earning.length} still earning {fmtMoney(monthlyRate)}/month.
          </p>
        )}
      </AdminCard>

      <div className="mt-6">
        <AdminCard title="Payout history">
          {payouts.length === 0 ? (
            <p className="text-sm text-gray-400 italic py-4 text-center">No payouts yet.</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {payouts.map(p => (
                <div key={p.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800">{fmtDate(p.paid_at)}</p>
                    <p className="text-xs text-gray-400">
                      {PAYOUT_METHOD_LABEL[p.method as PayoutMethod] ?? p.method}{p.reference ? ` · ${p.reference}` : ''}
                    </p>
                  </div>
                  <span className="text-sm font-medium text-gray-900 flex-shrink-0">{fmtMoney(p.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </AdminCard>
      </div>
    </div>
  )
}
