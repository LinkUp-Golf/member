'use client'

import { useState, useEffect, useCallback } from 'react'
import { AdminPageHeader, AdminCard, Badge } from '@/components/admin/AdminUI'
import type { ReferralPartnerLink } from '@/types'

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export default function PartnerReferralsPage() {
  const [links, setLinks] = useState<ReferralPartnerLink[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const res = await fetch('/api/partner/referrals')
    const json = await res.json().catch(() => ({}))
    setLinks(Array.isArray(json.links) ? json.links : [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="p-4 sm:p-8">
      <AdminPageHeader
        title="My Referrals"
        description="Everyone attributed to your referral code"
      />

      {loading ? (
        <div className="py-16 text-center text-sm text-gray-400">Loading…</div>
      ) : (
        // A stacked list rather than a table — it fits a phone screen without a
        // horizontal scrollbar and reads the same held in portrait or landscape.
        <AdminCard>
          {links.length === 0 ? (
            <p className="text-sm text-gray-400 italic py-6 text-center">
              No referrals yet. The LinkUp team attributes contacts to your code.
            </p>
          ) : (
            <div className="divide-y divide-gray-50">
              {links.map(link => {
                const isActive = link.member?.membership_status === 'active'
                const name = link.member ? `${link.member.first_name} ${link.member.last_name}`.trim() : null
                return (
                  <div key={link.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{name || link.email}</p>
                      {name && <p className="text-xs text-gray-400 truncate">{link.email}</p>}
                      <p className="text-xs text-gray-400 mt-0.5">Referred {fmtDate(link.created_at)}</p>
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
        </AdminCard>
      )}
    </div>
  )
}
