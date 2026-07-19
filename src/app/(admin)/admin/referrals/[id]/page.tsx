'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { AdminPageHeader, StatCard, Badge, AdminCard } from '@/components/admin/AdminUI'
import ReferralContactPicker, { type ReferralSelection } from '@/components/admin/ReferralContactPicker'
import type { ReferralPartner, ReferralPartnerLink, ReferralPartnerStats } from '@/types'

const fmtMoney = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 })

interface Analytics {
  partner: ReferralPartner
  stats: ReferralPartnerStats
  conversionRate: number
  membershipFee: number
}

export default function ReferralPartnerDetailPage() {
  const params = useParams()
  const id = params?.id as string

  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [links, setLinks] = useState<ReferralPartnerLink[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  // Linking state
  const [selection, setSelection] = useState<ReferralSelection>({ memberIds: [], emails: [] })
  const [assigning, setAssigning] = useState(false)
  const [result, setResult] = useState<{ succeeded: number; failed: string[] } | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  const loadAll = useCallback(async () => {
    const [aRes, lRes] = await Promise.all([
      fetch(`/api/admin/referral-partners/${id}/analytics`),
      fetch(`/api/admin/referral-partners/${id}/links`),
    ])
    const aJson = await aRes.json().catch(() => ({}))
    const lJson = await lRes.json().catch(() => ({}))
    if (aRes.ok) setAnalytics(aJson)
    setLinks(Array.isArray(lJson.links) ? lJson.links : [])
    setLoading(false)
  }, [id])

  useEffect(() => { loadAll() }, [loadAll])

  // Emails already linked to this partner — hide from the picker/entry as dupes.
  const linkedEmails = useMemo(() => new Set(links.map(l => l.email.toLowerCase())), [links])

  async function assign() {
    if (!selection.memberIds.length && !selection.emails.length) return
    setAssigning(true)
    setResult(null)
    const res = await fetch(`/api/admin/referral-partners/${id}/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(selection),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      showToast(json.error ?? 'Referring failed.', false)
    } else {
      setResult({ succeeded: json.succeeded ?? 0, failed: json.failed ?? [] })
      setSelection({ memberIds: [], emails: [] })
      showToast(`Referred ${json.succeeded} contact${json.succeeded !== 1 ? 's' : ''}.`)
      await loadAll()
    }
    setAssigning(false)
  }

  async function removeLink(linkId: string) {
    setRemovingId(linkId)
    const res = await fetch(`/api/admin/referral-partners/${id}/links/${linkId}`, { method: 'DELETE' })
    const json = await res.json().catch(() => ({}))
    if (res.ok) { showToast('Link removed.'); await loadAll() }
    else showToast(json.error ?? 'Remove failed.', false)
    setRemovingId(null)
  }

  if (loading) return <div className="p-8 text-sm text-gray-400">Loading…</div>
  if (!analytics) return <div className="p-8 text-sm text-red-500">Referral partner not found.</div>

  const { partner, stats, conversionRate, membershipFee } = analytics

  return (
    <div className="p-4 sm:p-8">
      {toast && (
        <div className={`fixed top-6 right-6 z-[60] px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${
          toast.ok ? 'bg-green-900 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.msg}
        </div>
      )}

      <Link href="/admin/referrals" className="text-sm text-gray-400 hover:text-gray-600 mb-4 inline-block">
        ← Back to Referral Partners
      </Link>

      <AdminPageHeader
        title={partner.name}
        description={`Code: ${partner.code} · ${partner.percentage}% of ${fmtMoney(membershipFee)} membership fee`}
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
        <StatCard label="Referred"     value={stats.referredCount} colour="blue" />
        <StatCard label="Members"      value={stats.memberCount} colour="green" />
        <StatCard label="Non-members"  value={stats.nonMemberCount} colour="gray" />
        <StatCard label="Active"       value={stats.activeCount} sub="Paying members" colour="green" />
        <StatCard label="Conversion"   value={`${Math.round(conversionRate * 100)}%`} colour="gold" />
        <StatCard label="Commission"   value={fmtMoney(stats.commissionOwed)} sub="Owed to date" colour="gold" />
      </div>

      {/* Link contacts */}
      <div className="mb-8">
        <AdminCard title="Refer Members & Non-members">
          <div className="space-y-5">
            <ReferralContactPicker value={selection} onChange={setSelection} linkedEmails={linkedEmails} />

            <button
              type="button"
              onClick={assign}
              disabled={assigning || (!selection.memberIds.length && !selection.emails.length)}
              className="w-full py-2.5 rounded-xl bg-green-900 text-white text-sm font-semibold hover:bg-green-800 disabled:opacity-40 transition-colors"
            >
              {assigning
                ? 'Referring…'
                : `Refer ${selection.memberIds.length + selection.emails.length} contact${selection.memberIds.length + selection.emails.length !== 1 ? 's' : ''}`}
            </button>

            {result && (
              <div className="text-xs rounded-xl px-4 py-3 bg-gray-50 border border-gray-100">
                <p className="text-gray-700 font-medium">Referred {result.succeeded} contact{result.succeeded !== 1 ? 's' : ''}.</p>
                {result.failed.length > 0 && (
                  <p className="text-red-500 mt-1">Failed: {result.failed.join(', ')}</p>
                )}
              </div>
            )}
          </div>
        </AdminCard>
      </div>

      {/* Linked list */}
      <AdminCard title={`Referred Contacts (${links.length})`}>
        {links.length === 0 ? (
          <p className="text-sm text-gray-400 italic py-4 text-center">No contacts referred yet.</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {links.map(link => {
              const isMember = !!link.member_id
              const isActive = link.member?.membership_status === 'active'
              return (
                <div key={link.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">
                      {link.member ? `${link.member.first_name} ${link.member.last_name}` : link.email}
                    </p>
                    {link.member && <p className="text-xs text-gray-400 truncate">{link.email}</p>}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge label={isMember ? 'Member' : 'Non-member'} colour={isMember ? 'green' : 'gray'} />
                    {isActive && <Badge label="Active" colour="green" />}
                    <button
                      onClick={() => removeLink(link.id)}
                      disabled={removingId === link.id}
                      className="text-xs font-medium text-red-500 hover:text-red-700 px-2 py-1 disabled:opacity-40"
                    >
                      {removingId === link.id ? '…' : 'Remove'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </AdminCard>
    </div>
  )
}
