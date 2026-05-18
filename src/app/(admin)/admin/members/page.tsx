'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import {
  AdminPageHeader, AdminTable, AdminTr, AdminTd,
  Badge, AdminButton, AdminCard,
} from '@/components/admin/AdminUI'
import { format } from 'date-fns'
import type { MemberWithProfile } from '@/types'

type FilterStatus = 'all' | 'active' | 'waitlist' | 'pending' | 'cancelled'

export default function AdminMembersPage() {
  const [members, setMembers] = useState<MemberWithProfile[]>([])
  const [filtered, setFiltered] = useState<MemberWithProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all')
  const [selected, setSelected] = useState<MemberWithProfile | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { loadMembers() }, [])

  useEffect(() => {
    let result = members
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(m =>
        `${m.first_name} ${m.last_name}`.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q) ||
        m.profile?.business_name?.toLowerCase().includes(q) ||
        m.profile?.industry_category?.toLowerCase().includes(q)
      )
    }
    if (statusFilter !== 'all') {
      result = result.filter(m => m.membership_status === statusFilter)
    }
    setFiltered(result)
  }, [search, statusFilter, members])

  async function loadMembers() {
    const supabase = createClient()
    const { data } = await supabase
      .from('members')
      .select('*, profile:member_profiles(*), home_course:courses(*)')
      .order('created_at', { ascending: false })
    setMembers((data ?? []) as MemberWithProfile[])
    setFiltered((data ?? []) as MemberWithProfile[])
    setLoading(false)
  }

  async function updateStatus(memberId: string, status: string) {
    setSaving(true)
    const supabase = createClient()
    await supabase.from('members').update({ membership_status: status }).eq('id', memberId)

    // If activating from waitlist, also activate course membership
    if (status === 'active') {
      const member = members.find(m => m.id === memberId)
      if (member) {
        await supabase
          .from('course_memberships')
          .update({ status: 'active' })
          .eq('member_id', memberId)
          .eq('course_id', member.home_course_id)
      }
    }

    await loadMembers()
    if (selected?.id === memberId) {
      setSelected(prev => prev ? { ...prev, membership_status: status as any } : null)
    }
    setSaving(false)
  }

  async function toggleAdmin(memberId: string, isAdmin: boolean) {
    setSaving(true)
    const supabase = createClient()
    await supabase.from('members').update({ is_admin: !isAdmin }).eq('id', memberId)
    await loadMembers()
    setSaving(false)
  }

  const statusCounts = {
    all:       members.length,
    active:    members.filter(m => m.membership_status === 'active').length,
    waitlist:  members.filter(m => m.membership_status === 'waitlist').length,
    pending:   members.filter(m => m.membership_status === 'pending').length,
    cancelled: members.filter(m => m.membership_status === 'cancelled').length,
  }

  return (
    <div className="p-8 max-w-7xl">
      <AdminPageHeader
        title="Members"
        subtitle={`${statusCounts.active} active · ${statusCounts.waitlist} waitlisted · ${statusCounts.pending} pending`}
      />

      <div className="flex gap-6">
        {/* Main list */}
        <div className="flex-1 min-w-0">
          {/* Filters */}
          <div className="flex gap-3 mb-4 items-center">
            <input
              type="search"
              placeholder="Search members…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 px-4 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-green-500"
            />
            <div className="flex gap-1">
              {(['all', 'active', 'waitlist', 'pending', 'cancelled'] as FilterStatus[]).map(s => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                    statusFilter === s
                      ? 'bg-green-900 text-white'
                      : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {s} {statusCounts[s] > 0 && <span className="ml-0.5 opacity-60">({statusCounts[s]})</span>}
                </button>
              ))}
            </div>
          </div>

          <AdminTable
            headers={['Member', 'Category', 'Status', 'Joined', 'Actions']}
            empty={loading ? 'Loading…' : filtered.length === 0 ? 'No members match your search.' : undefined}
          >
            {filtered.map(m => (
              <AdminTr key={m.id} onClick={() => setSelected(m)}>
                <AdminTd>
                  <div>
                    <p className="font-medium text-gray-900">{m.first_name} {m.last_name}</p>
                    <p className="text-xs text-gray-400">{m.email}</p>
                    {m.profile?.business_name && (
                      <p className="text-xs text-gray-400">{m.profile.business_name}</p>
                    )}
                  </div>
                </AdminTd>
                <AdminTd>
                  <span className="text-xs text-gray-500">
                    {m.profile?.industry_category ?? '—'}
                  </span>
                </AdminTd>
                <AdminTd>
                  <StatusBadge status={m.membership_status} />
                  {(m as any).is_admin && (
                    <span className="ml-1.5 text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full">Admin</span>
                  )}
                </AdminTd>
                <AdminTd>
                  <span className="text-xs text-gray-400">
                    {m.membership_start_date
                      ? format(new Date(m.membership_start_date), 'MMM d, yyyy')
                      : format(new Date(m.created_at), 'MMM d, yyyy')}
                  </span>
                </AdminTd>
                <AdminTd>
                  <div className="flex gap-1.5" onClick={e => e.stopPropagation()}>
                    {m.membership_status === 'waitlist' && (
                      <AdminButton
                        label="Activate"
                        onClick={() => updateStatus(m.id, 'active')}
                        variant="gold"
                        size="sm"
                        disabled={saving}
                      />
                    )}
                    {m.membership_status === 'active' && (
                      <AdminButton
                        label="Suspend"
                        onClick={() => updateStatus(m.id, 'suspended')}
                        variant="danger"
                        size="sm"
                        disabled={saving}
                      />
                    )}
                    {(m.membership_status === 'suspended' || m.membership_status === 'cancelled') && (
                      <AdminButton
                        label="Reinstate"
                        onClick={() => updateStatus(m.id, 'active')}
                        variant="primary"
                        size="sm"
                        disabled={saving}
                      />
                    )}
                  </div>
                </AdminTd>
              </AdminTr>
            ))}
          </AdminTable>
        </div>

        {/* Member detail panel */}
        {selected && (
          <div className="w-72 flex-shrink-0">
            <AdminCard>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="font-semibold text-gray-900">{selected.first_name} {selected.last_name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{selected.email}</p>
                </div>
                <button onClick={() => setSelected(null)} className="text-gray-300 hover:text-gray-500 text-lg">×</button>
              </div>

              <div className="space-y-3 text-sm">
                <DetailRow label="Status"><StatusBadge status={selected.membership_status} /></DetailRow>
                <DetailRow label="Category">{selected.profile?.industry_category ?? '—'}</DetailRow>
                <DetailRow label="Business">{selected.profile?.business_name ?? '—'}</DetailRow>
                <DetailRow label="Role">{selected.profile?.role_title ?? '—'}</DetailRow>
                <DetailRow label="GHL ID">
                  <span className="font-mono text-xs text-gray-400">{selected.ghl_contact_id}</span>
                </DetailRow>
                {selected.profile?.handicap_index && selected.profile?.show_handicap && (
                  <DetailRow label="Handicap">{selected.profile.handicap_index}</DetailRow>
                )}
              </div>

              {selected.profile?.value_offered && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <p className="text-xs text-gray-400 uppercase tracking-wider mb-1.5">Value offered</p>
                  <p className="text-xs text-gray-600 leading-relaxed">{selected.profile.value_offered}</p>
                </div>
              )}

              {selected.profile?.value_sought && (
                <div className="mt-3">
                  <p className="text-xs text-gray-400 uppercase tracking-wider mb-1.5">Looking for</p>
                  <p className="text-xs text-gray-600 leading-relaxed">{selected.profile.value_sought}</p>
                </div>
              )}

              {/* Admin actions */}
              <div className="mt-5 pt-4 border-t border-gray-100 space-y-2">
                <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">Actions</p>
                {selected.membership_status === 'waitlist' && (
                  <AdminButton label="Activate membership" onClick={() => updateStatus(selected.id, 'active')} variant="gold" disabled={saving} />
                )}
                {selected.membership_status === 'active' && (
                  <AdminButton label="Suspend membership" onClick={() => updateStatus(selected.id, 'suspended')} variant="danger" disabled={saving} />
                )}
                {selected.membership_status === 'suspended' && (
                  <AdminButton label="Reinstate membership" onClick={() => updateStatus(selected.id, 'active')} variant="primary" disabled={saving} />
                )}
                <AdminButton
                  label={(selected as any).is_admin ? 'Remove admin access' : 'Grant admin access'}
                  onClick={() => toggleAdmin(selected.id, (selected as any).is_admin)}
                  variant="ghost"
                  disabled={saving}
                />
              </div>
            </AdminCard>
          </div>
        )}
      </div>
    </div>
  )
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="text-xs text-gray-400 flex-shrink-0">{label}</span>
      <span className="text-xs text-gray-700 text-right">{children}</span>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; colour: 'green' | 'yellow' | 'blue' | 'red' | 'gray' }> = {
    active:    { label: 'Active',    colour: 'green' },
    waitlist:  { label: 'Waitlist',  colour: 'yellow' },
    pending:   { label: 'Pending',   colour: 'blue' },
    suspended: { label: 'Suspended', colour: 'red' },
    cancelled: { label: 'Cancelled', colour: 'gray' },
  }
  const s = map[status] ?? { label: status, colour: 'gray' as const }
  return <Badge label={s.label} colour={s.colour} />
}
