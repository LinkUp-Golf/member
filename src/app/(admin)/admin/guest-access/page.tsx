'use client'

import { useState, useEffect, useMemo } from 'react'
import { useAuthStore } from '@/store/auth'
import { createClient } from '@/lib/supabase'
import { AdminPageHeader, AdminTable, AdminTr, AdminTd, Badge, AdminButton } from '@/components/admin/AdminUI'
import { formatBookingDate, formatRelativeTime, capitalizeName } from '@/lib/utils'
import type { GuestAccessStatus } from '@/types'

interface GuestAccessRow {
  id: string
  status: GuestAccessStatus
  requesting_member_id: string
  target_course_id: string
  reason: string
  visit_from: string
  visit_until: string
  created_at: string
  reviewed_by: string | null
  requesting_member: {
    id: string
    first_name: string
    last_name: string
    email: string
    profile: { role_title: string | null; business_name: string | null; industry_category: string | null } | null
  } | null
  target_course: { name: string; city: string } | null
}

type FilterTab = GuestAccessStatus | 'all'

const FILTER_TABS: FilterTab[] = ['pending', 'approved', 'revoked', 'denied', 'all']

const BADGE_MAP: Record<GuestAccessStatus, { label: string; colour: 'yellow' | 'green' | 'red' | 'gray' }> = {
  pending:  { label: 'Pending',  colour: 'yellow' },
  approved: { label: 'Approved', colour: 'green' },
  denied:   { label: 'Denied',   colour: 'red' },
  revoked:  { label: 'Revoked',  colour: 'gray' },
}

export default function AdminGuestAccessPage() {
  const { user } = useAuthStore()
  const [requests, setRequests] = useState<GuestAccessRow[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterTab>('pending')
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  useEffect(() => { loadRequests() }, [])

  async function loadRequests() {
    const supabase = createClient()
    const { data } = await supabase
      .from('guest_access_requests')
      .select(`
        *,
        requesting_member:members!requesting_member_id(
          id, first_name, last_name, email,
          profile:member_profiles(business_name, role_title, industry_category)
        ),
        target_course:courses(name, city)
      `)
      .order('created_at', { ascending: false })
    setRequests(data ?? [])
    setLoading(false)
  }

  async function decide(id: string, decision: 'approved' | 'denied', request: GuestAccessRow) {
    setProcessing(id)
    const supabase = createClient()

    await supabase
      .from('guest_access_requests')
      .update({ status: decision, reviewed_by: user?.id })
      .eq('id', id)

    if (decision === 'approved') {
      await supabase.from('course_memberships').upsert({
        member_id: request.requesting_member_id,
        course_id: request.target_course_id,
        access_type: 'guest',
        status: 'active',
        granted_by: user?.id,
        valid_from: request.visit_from,
        valid_until: request.visit_until,
      }, { onConflict: 'member_id,course_id,access_type' })

      const member = request.requesting_member
      if (!member) { showToast('Access approved.'); return }
      await supabase.from('announcements').insert({
        course_id: request.target_course_id,
        author_id: user?.id,
        type: 'visiting_member',
        title: `${member.first_name} ${member.last_name} is visiting`,
        body: `${member.first_name} ${member.last_name} (${member.profile?.role_title ?? ''}, ${member.profile?.business_name ?? ''}) is visiting from ${formatBookingDate(request.visit_from)} to ${formatBookingDate(request.visit_until)}. Reach out to play a round together.`,
        metadata: {
          visiting_member_id: request.requesting_member_id,
          visit_from: request.visit_from,
          visit_until: request.visit_until,
        },
        status: 'published',
        published_at: new Date().toISOString(),
      })

      showToast('Access approved and visiting member announcement posted.')
    } else {
      showToast('Request denied.')
    }

    await loadRequests()
    setProcessing(null)
  }

  async function revoke(id: string) {
    setProcessing(`revoke-${id}`)
    const res = await fetch(`/api/admin/guest-access/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'revoke' }),
    })
    if (res.ok) {
      showToast('Access revoked.')
      await loadRequests()
    } else {
      showToast('Revoke failed. Please try again.', false)
    }
    setProcessing(null)
  }

  const filtered = filter === 'all' ? requests : requests.filter(r => r.status === filter)

  const counts: Record<FilterTab, number> = {
    all: requests.length,
    pending:  requests.filter(r => r.status === 'pending').length,
    approved: requests.filter(r => r.status === 'approved').length,
    revoked:  requests.filter(r => r.status === 'revoked').length,
    denied:   requests.filter(r => r.status === 'denied').length,
  }

  // Hosting history: count of all requests per member id
  const hostingCounts = useMemo(() => {
    const map: Record<string, number> = {}
    requests.forEach(r => {
      const id = r.requesting_member_id
      map[id] = (map[id] ?? 0) + 1
    })
    return map
  }, [requests])

  return (
    <div className="p-4 sm:p-8 max-w-6xl">
      <AdminPageHeader
        title="Guest Access"
        description={`${counts.pending} request${counts.pending !== 1 ? 's' : ''} pending review · ${counts.approved} active`}
      />

      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium transition-all ${
          toast.ok ? 'bg-green-900 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2 mb-5 flex-wrap">
        {FILTER_TABS.map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
              filter === s
                ? 'bg-green-900 text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {s} <span className="opacity-60">({counts[s]})</span>
          </button>
        ))}
      </div>

      <AdminTable
        headers={['Member', 'Destination', 'Visit dates', 'Reason', 'Submitted', 'Status', 'Actions']}
        empty={loading ? 'Loading…' : filtered.length === 0 ? 'No requests in this category.' : undefined}
      >
        {filtered.map(r => {
          const totalRequests = hostingCounts[r.requesting_member_id] ?? 1
          const isProcessingThis = processing === r.id || processing === `revoke-${r.id}`

          return (
            <AdminTr key={r.id}>
              <AdminTd>
                <p className="font-medium text-gray-900">
                  {capitalizeName(r.requesting_member?.first_name ?? '')} {capitalizeName(r.requesting_member?.last_name ?? '')}
                </p>
                <p className="text-xs text-gray-400">{r.requesting_member?.profile?.role_title}</p>
                <p className="text-xs text-gray-400">{r.requesting_member?.profile?.business_name}</p>
                {totalRequests > 1 && (
                  <p className="text-xs text-blue-500 mt-0.5">{totalRequests} total requests</p>
                )}
              </AdminTd>
              <AdminTd>
                <p className="text-sm text-gray-700">{r.target_course?.name}</p>
                <p className="text-xs text-gray-400">{r.target_course?.city}</p>
              </AdminTd>
              <AdminTd>
                <p className="text-xs text-gray-600">
                  {formatBookingDate(r.visit_from)}<br />→ {formatBookingDate(r.visit_until)}
                </p>
              </AdminTd>
              <AdminTd>
                <p className="text-xs text-gray-600 max-w-xs line-clamp-3">{r.reason}</p>
              </AdminTd>
              <AdminTd>
                <span className="text-xs text-gray-400">{formatRelativeTime(r.created_at)}</span>
              </AdminTd>
              <AdminTd>
                <Badge
                  label={BADGE_MAP[r.status as GuestAccessStatus]?.label ?? r.status}
                  colour={BADGE_MAP[r.status as GuestAccessStatus]?.colour ?? 'gray'}
                />
              </AdminTd>
              <AdminTd>
                <div className="flex gap-1.5 flex-wrap" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()} role="presentation">
                  {r.status === 'pending' && (
                    <>
                      <AdminButton
                        label="✓ Approve"
                        onClick={() => decide(r.id, 'approved', r)}
                        variant="gold"
                        size="sm"
                        disabled={isProcessingThis}
                      />
                      <AdminButton
                        label="✕ Deny"
                        onClick={() => decide(r.id, 'denied', r)}
                        variant="danger"
                        size="sm"
                        disabled={isProcessingThis}
                      />
                    </>
                  )}
                  {r.status === 'approved' && (
                    <AdminButton
                      label="Revoke"
                      onClick={() => revoke(r.id)}
                      variant="danger"
                      size="sm"
                      disabled={isProcessingThis}
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
