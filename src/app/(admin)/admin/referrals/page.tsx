'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import {
  AdminPageHeader, AdminTable, AdminTr, AdminTd, Badge,
  AdminButton, StatCard,
} from '@/components/admin/AdminUI'
import { formatRelativeTime } from '@/lib/utils'
import { differenceInDays } from 'date-fns'
import type { ReferralStatus } from '@/types'

interface ReferralRow {
  id: string
  status: ReferralStatus
  referred_email: string
  referred_member_industry: string | null
  first_round_free: boolean
  created_at: string
  updated_at: string
  referring_member: { first_name: string; last_name: string; email: string } | null
  referred_member: { first_name: string; last_name: string; email: string } | null
}

const STAGES = ['pending', 'interviewed', 'approved', 'joined', 'declined'] as const
type Stage = typeof STAGES[number]

const STAGE_META: Record<Stage, { label: string; colour: 'yellow' | 'blue' | 'green' | 'red' | 'gray'; statColour: 'gold' | 'blue' | 'green' | 'red' | 'gray' }> = {
  pending:     { label: 'Pending',     colour: 'yellow', statColour: 'gold' },
  interviewed: { label: 'Interviewed', colour: 'blue',   statColour: 'blue' },
  approved:    { label: 'Approved',    colour: 'green',  statColour: 'green' },
  joined:      { label: 'Joined ✓',   colour: 'green',  statColour: 'green' },
  declined:    { label: 'Declined',    colour: 'red',    statColour: 'red' },
}

export default function AdminReferralsPage() {
  const [referrals, setReferrals] = useState<ReferralRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | Stage>('all')
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

  async function updateStatus(id: string, status: Stage) {
    setProcessing(id)
    const supabase = createClient()
    await supabase.from('referrals').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
    await loadReferrals()
    setProcessing(null)
  }

  const filtered = filter === 'all' ? referrals : referrals.filter(r => r.status === filter)

  const counts: Record<string, number> = { all: referrals.length }
  STAGES.forEach(s => { counts[s] = referrals.filter(r => r.status === s).length })

  return (
    <div className="p-4 sm:p-8 max-w-6xl">
      <AdminPageHeader
        title="Referral Pipeline"
        description={`${counts.pending ?? 0} pending · ${counts.interviewed ?? 0} interviewed · ${counts.joined ?? 0} joined`}
      />

      {/* Stage stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        {STAGES.map(s => (
          <StatCard
            key={s}
            label={STAGE_META[s].label}
            value={counts[s] ?? 0}
            colour={STAGE_META[s].statColour}
          />
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-5 flex-wrap">
        {(['all', ...STAGES] as const).map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
              filter === s
                ? 'bg-green-900 text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {s === 'all' ? 'All' : STAGE_META[s].label}
            {(counts[s] ?? 0) > 0 && (
              <span className="ml-1 opacity-60">({counts[s]})</span>
            )}
          </button>
        ))}
      </div>

      <AdminTable
        headers={['Referred by', 'Prospect', 'Industry', 'Status', 'Days in stage', 'Submitted', 'Actions']}
        empty={loading ? 'Loading…' : filtered.length === 0 ? 'No referrals in this category.' : undefined}
      >
        {filtered.map(r => {
          const daysInStage = differenceInDays(new Date(), new Date(r.updated_at))
          const isStale = daysInStage > 14 && r.status !== 'joined' && r.status !== 'declined'

          return (
            <AdminTr key={r.id}>
              <AdminTd>
                <p className="font-medium text-gray-900 capitalize">
                  {r.referring_member?.first_name ?? ''} {r.referring_member?.last_name ?? ''}
                </p>
                <p className="text-xs text-gray-400">{r.referring_member?.email}</p>
              </AdminTd>
              <AdminTd>
                {r.referred_member ? (
                  <>
                    <p className="font-medium text-gray-900 capitalize">
                      {r.referred_member.first_name} {r.referred_member.last_name}
                    </p>
                    <p className="text-xs text-gray-400">{r.referred_member.email}</p>
                  </>
                ) : (
                  <p className="text-sm text-gray-600">{r.referred_email}</p>
                )}
                {r.first_round_free && r.status === 'joined' && (
                  <span className="text-xs text-green-600">First round free ✓</span>
                )}
              </AdminTd>
              <AdminTd>
                {r.referred_member_industry ? (
                  <span className="text-xs text-gray-500">{r.referred_member_industry}</span>
                ) : (
                  <span className="text-gray-300">—</span>
                )}
              </AdminTd>
              <AdminTd>
                <Badge label={STAGE_META[r.status as Stage]?.label ?? r.status} colour={STAGE_META[r.status as Stage]?.colour ?? 'gray'} />
              </AdminTd>
              <AdminTd>
                <span className={`text-xs font-medium ${isStale ? 'text-orange-600' : 'text-gray-500'}`}>
                  {daysInStage === 0 ? 'Today' : `${daysInStage}d`}
                </span>
                {isStale && <p className="text-xs text-orange-400">Needs attention</p>}
              </AdminTd>
              <AdminTd>
                <span className="text-xs text-gray-400">{formatRelativeTime(r.created_at)}</span>
              </AdminTd>
              <AdminTd>
                <div className="flex gap-1.5 flex-wrap" role="presentation" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
                  {r.status === 'pending' && (
                    <AdminButton
                      label="Mark interviewed"
                      onClick={() => updateStatus(r.id, 'interviewed')}
                      variant="ghost"
                      size="sm"
                      disabled={processing === r.id}
                    />
                  )}
                  {r.status === 'interviewed' && (
                    <>
                      <AdminButton
                        label="✓ Approve"
                        onClick={() => updateStatus(r.id, 'approved')}
                        variant="gold"
                        size="sm"
                        disabled={processing === r.id}
                      />
                      <AdminButton
                        label="✕ Decline"
                        onClick={() => updateStatus(r.id, 'declined')}
                        variant="danger"
                        size="sm"
                        disabled={processing === r.id}
                      />
                    </>
                  )}
                  {r.status === 'approved' && (
                    <AdminButton
                      label="Mark joined"
                      onClick={() => updateStatus(r.id, 'joined')}
                      variant="primary"
                      size="sm"
                      disabled={processing === r.id}
                    />
                  )}
                  {r.status === 'declined' && (
                    <AdminButton
                      label="Reopen"
                      onClick={() => updateStatus(r.id, 'pending')}
                      variant="ghost"
                      size="sm"
                      disabled={processing === r.id}
                    />
                  )}
                </div>
              </AdminTd>
            </AdminTr>
          )
        })}
      </AdminTable>
    </div>
  )
}
