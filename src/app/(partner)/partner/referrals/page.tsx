'use client'

import { useState, useEffect, useCallback } from 'react'
import { AdminPageHeader, AdminTable, AdminTr, AdminTd, Badge } from '@/components/admin/AdminUI'
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
        <AdminTable
          headers={['Contact', 'Referred', 'Status']}
          empty={links.length === 0 ? 'No referrals yet. The LinkUp team attributes contacts to your code.' : undefined}
        >
          {links.map(link => {
            const isActive = link.member?.membership_status === 'active'
            return (
              <AdminTr key={link.id}>
                <AdminTd className="font-medium text-gray-900">
                  <span className="block">
                    {link.member ? `${link.member.first_name} ${link.member.last_name}` : link.email}
                  </span>
                  {link.member && (
                    <span className="block text-xs text-gray-400 font-normal">{link.email}</span>
                  )}
                </AdminTd>
                <AdminTd>{fmtDate(link.created_at)}</AdminTd>
                <AdminTd>
                  {isActive
                    ? <Badge label="Active" colour="green" />
                    : <Badge label="Referred" colour="blue" />}
                </AdminTd>
              </AdminTr>
            )
          })}
        </AdminTable>
      )}
    </div>
  )
}
