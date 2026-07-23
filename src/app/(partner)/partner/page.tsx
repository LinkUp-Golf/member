'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { AdminPageHeader, StatCard, AdminCard, Badge } from '@/components/admin/AdminUI'
import { ContentLoader } from '@/components/ui/Loading'
import { isRateExpired } from '@/lib/referral-rate'
import type { ReferralPartner, ReferralPartnerStats, ReferralPartnerLink } from '@/types'

const fmtMoney = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 })

const fmtDate = (d: string) =>
  new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

interface Conversion {
  linkId: string
  email: string
  name: string | null
  convertedAt: string
  commission: number
  withinRateWindow: boolean
}

interface Overview {
  partner: ReferralPartner
  stats: ReferralPartnerStats
  conversionRate: number
  membershipFee: number
  conversions: Conversion[]
}

export default function PartnerOverviewPage() {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [links, setLinks] = useState<ReferralPartnerLink[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    // Overview drives the stats and earnings ledger; the referrals list feeds
    // the "Recent Referrals" card (everyone referred, converted or not).
    const [overviewRes, referralsRes] = await Promise.all([
      fetch('/api/partner/overview'),
      fetch('/api/partner/referrals'),
    ])
    const json = await overviewRes.json().catch(() => ({}))
    if (!overviewRes.ok) setError(json.error ?? 'Failed to load your referral data.')
    else setOverview(json)

    const referralsJson = await referralsRes.json().catch(() => ({}))
    setLinks(Array.isArray(referralsJson.links) ? referralsJson.links : [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <ContentLoader />
  if (error || !overview) return <div className="p-8 text-sm text-red-500">{error ?? 'Not found.'}</div>

  const { partner, stats, conversionRate, membershipFee, conversions } = overview
  const expired = isRateExpired(partner.ends_at)

  // Most recent conversions first — this is the partner's earnings ledger.
  const recent = [...conversions].sort((a, b) => b.convertedAt.localeCompare(a.convertedAt)).slice(0, 10)

  // Everyone referred, newest first — includes people who haven't converted yet,
  // which the conversions ledger deliberately omits.
  const recentReferrals = [...links].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5)

  return (
    <div className="p-4 sm:p-8">
      <AdminPageHeader
        title="Your Referrals"
        description={
          `Code: ${partner.code} · ${partner.percentage}% of the ${fmtMoney(membershipFee)} membership fee` +
          (partner.ends_at ? ` · rate ${expired ? 'expired' : 'valid until'} ${fmtDate(partner.ends_at)}` : '')
        }
      />

      {expired && partner.ends_at && (
        <div className="mb-6 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
          <p className="text-xs text-amber-700">
            Your commission rate expired on {fmtDate(partner.ends_at)}. Referrals who join after that date
            don&apos;t earn commission — reach out to the LinkUp team to renew your rate.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-8">
        <StatCard label="Referred"    value={stats.referredCount} sub="Total contacts" colour="blue" />
        <StatCard label="Active"      value={stats.activeCount}   sub="Paying members" colour="green" />
        <StatCard label="Conversion"  value={`${Math.round(conversionRate * 100)}%`}   colour="gold" />
        <StatCard label="Rate"        value={`${partner.percentage}%`} sub={expired ? 'Expired' : 'Per member'} colour={expired ? 'gray' : 'green'} />
        <StatCard label="Commissions" value={fmtMoney(stats.commissionOwed)} sub="Earned to date" colour="gold" />
      </div>

      <div className="mb-6">
        <AdminCard title="Recent Referrals">
          {recentReferrals.length === 0 ? (
            <p className="text-sm text-gray-400 italic py-4 text-center">
              No referrals yet — the LinkUp team attributes contacts to your code.
            </p>
          ) : (
            <div className="divide-y divide-gray-50">
              {recentReferrals.map(link => {
                const isActive = link.member?.membership_status === 'active'
                const name = link.member ? `${link.member.first_name} ${link.member.last_name}`.trim() : null
                return (
                  <div key={link.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{name || link.email}</p>
                      <p className="text-xs text-gray-400">Referred {fmtDate(link.created_at)}</p>
                    </div>
                    <div className="flex-shrink-0">
                      {isActive
                        ? <Badge label="Active" colour="green" />
                        : <Badge label="Referred" colour="blue" />}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <div className="pt-4 mt-2 border-t border-gray-50">
            <Link href="/partner/referrals" className="text-sm text-green-800 hover:underline">
              View all referrals →
            </Link>
          </div>
        </AdminCard>
      </div>

      <AdminCard title="Recent Conversions">
        {recent.length === 0 ? (
          <p className="text-sm text-gray-400 italic py-4 text-center">
            None of your referrals have become paying members yet.
          </p>
        ) : (
          <div className="divide-y divide-gray-50">
            {recent.map(c => (
              <div key={c.linkId} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{c.name ?? c.email}</p>
                  <p className="text-xs text-gray-400">Joined {fmtDate(c.convertedAt)}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-medium text-gray-900">{fmtMoney(c.commission)}</p>
                  {!c.withinRateWindow && (
                    <p className="text-[11px] text-gray-400">Outside rate term</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="pt-4 mt-2 border-t border-gray-50">
          <Link href="/partner/referrals" className="text-sm text-green-800 hover:underline">
            View all referrals →
          </Link>
        </div>
      </AdminCard>
    </div>
  )
}
