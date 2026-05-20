'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { AdminPageHeader, AdminTable, AdminTr, AdminTd, Badge, AdminButton } from '@/components/admin/AdminUI'
import { formatRelativeTime } from '@/lib/utils'

const STATUS_ORDER = ['pending', 'interviewed', 'approved', 'joined', 'declined']

export default function AdminReferralsPage() {
  const [referrals, setReferrals] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [processing, setProcessing] = useState<string | null>(null)

  useEffect(() => { loadReferrals() }, [])

  async function loadReferrals() {
    const supabase = createClient()
    const { data } = await supabase
      .from('referrals')
      .select(`
        *,
        referring_member:members!referring_member_id(first_name, last_name, email),
        referred_member:members!referred_member_id(first_name, last_name, email)
      `)
      .order('created_at', { ascending: false })
    setReferrals(data ?? [])
    setLoading(false)
  }

  async function updateStatus(id: string, status: string) {
    setProcessing(id)
    const supabase = createClient()
    await supabase.from('referrals').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
    await loadReferrals()
    setProcessing(null)
  }

  const filtered = filter === 'all' ? referrals : referrals.filter(r => r.status === filter)
  const counts: Record<string, number> = { all: referrals.length }
  STATUS_ORDER.forEach(s => { counts[s] = referrals.filter(r => r.status === s).length })

  return (
    <div className="p-8 max-w-6xl">
      <AdminPageHeader
        title="Referral Pipeline"
        description={`${counts.pending ?? 0} pending · ${counts.interviewed ?? 0} interviewed · ${counts.joined ?? 0} joined`}
      />

      {/* Status filter */}
      <div className="flex gap-2 mb-5 flex-wrap">
        {['all', ...STATUS_ORDER].map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
              filter === s
                ? 'bg-green-900 text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {s} {(counts[s] ?? 0) > 0 && <span className="opacity-60">({counts[s] ?? 0})</span>}
          </button>
        ))}
      </div>

      <AdminTable
        headers={['Referred by', 'Prospect', 'Status', 'Submitted', 'Actions']}
        empty={loading ? 'Loading…' : filtered.length === 0 ? 'No referrals in this category.' : undefined}
      >
        {filtered.map(r => (
          <AdminTr key={r.id}>
            <AdminTd>
              <p className="font-medium text-gray-900">
                {r.referring_member?.first_name} {r.referring_member?.last_name}
              </p>
              <p className="text-xs text-gray-400">{r.referring_member?.email}</p>
            </AdminTd>
            <AdminTd>
              {r.referred_member ? (
                <>
                  <p className="font-medium text-gray-900">
                    {r.referred_member.first_name} {r.referred_member.last_name}
                  </p>
                  <p className="text-xs text-gray-400">{r.referred_member.email}</p>
                </>
              ) : (
                <p className="text-gray-600">{r.referred_email}</p>
              )}
              {r.first_round_free && r.status === 'joined' && (
                <span className="text-xs text-green-600">First round free ✓</span>
              )}
            </AdminTd>
            <AdminTd>
              <ReferralBadge status={r.status} />
            </AdminTd>
            <AdminTd>
              <span className="text-xs text-gray-400">{formatRelativeTime(r.created_at)}</span>
            </AdminTd>
            <AdminTd>
              <div className="flex gap-1.5 flex-wrap" onClick={e => e.stopPropagation()}>
                {r.status === 'pending' && (
                  <AdminButton label="Mark interviewed" onClick={() => updateStatus(r.id, 'interviewed')} variant="ghost" size="sm" disabled={processing === r.id} />
                )}
                {r.status === 'interviewed' && (
                  <>
                    <AdminButton label="✓ Approve" onClick={() => updateStatus(r.id, 'approved')} variant="gold" size="sm" disabled={processing === r.id} />
                    <AdminButton label="✕ Decline" onClick={() => updateStatus(r.id, 'declined')} variant="danger" size="sm" disabled={processing === r.id} />
                  </>
                )}
                {r.status === 'approved' && (
                  <AdminButton label="Mark joined" onClick={() => updateStatus(r.id, 'joined')} variant="primary" size="sm" disabled={processing === r.id} />
                )}
                {r.status === 'declined' && (
                  <AdminButton label="Reopen" onClick={() => updateStatus(r.id, 'pending')} variant="ghost" size="sm" disabled={processing === r.id} />
                )}
              </div>
            </AdminTd>
          </AdminTr>
        ))}
      </AdminTable>
    </div>
  )
}

function ReferralBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; colour: 'yellow' | 'blue' | 'green' | 'red' | 'gray' }> = {
    pending:     { label: 'Pending',     colour: 'yellow' },
    interviewed: { label: 'Interviewed', colour: 'blue' },
    approved:    { label: 'Approved',    colour: 'green' },
    joined:      { label: 'Joined ✓',   colour: 'green' },
    declined:    { label: 'Declined',    colour: 'red' },
  }
  const s = map[status] ?? { label: status, colour: 'gray' as const }
  return <Badge label={s.label} colour={s.colour} />
}
