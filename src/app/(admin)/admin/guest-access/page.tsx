'use client'

import { useState, useEffect } from 'react'
import { useAuthStore } from '@/store/auth'
import { createClient } from '@/lib/supabase'
import { AdminPageHeader, AdminTable, AdminTr, AdminTd, Badge, AdminButton } from '@/components/admin/AdminUI'
import { formatBookingDate, formatRelativeTime } from '@/lib/utils'

export default function AdminGuestAccessPage() {
  const { user } = useAuthStore()
  const [requests, setRequests] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState<string | null>(null)
  const [filter, setFilter] = useState<'pending' | 'approved' | 'denied' | 'all'>('pending')

  useEffect(() => { loadRequests() }, [])

  async function loadRequests() {
    const supabase = createClient()
    const { data } = await supabase
      .from('guest_access_requests')
      .select(`
        *,
        requesting_member:members(first_name, last_name, email,
          profile:member_profiles(business_name, role_title, industry_category)),
        target_course:courses(name, city)
      `)
      .order('created_at', { ascending: false })
    setRequests(data ?? [])
    setLoading(false)
  }

  async function decide(id: string, decision: 'approved' | 'denied', request: any) {
    setProcessing(id)
    const supabase = createClient()

    await supabase
      .from('guest_access_requests')
      .update({ status: decision, reviewed_by: user?.id })
      .eq('id', id)

    if (decision === 'approved') {
      // Create temporary course membership
      await supabase.from('course_memberships').upsert({
        member_id: request.requesting_member_id,
        course_id: request.target_course_id,
        access_type: 'guest',
        status: 'active',
        granted_by: user?.id,
        valid_from: request.visit_from,
        valid_until: request.visit_until,
      }, { onConflict: 'member_id,course_id,access_type' })

      // Fire visiting member announcement to target community
      const member = request.requesting_member
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
    }

    await loadRequests()
    setProcessing(null)
  }

  const filtered = filter === 'all' ? requests : requests.filter(r => r.status === filter)
  const pendingCount = requests.filter(r => r.status === 'pending').length

  return (
    <div className="p-8 max-w-6xl">
      <AdminPageHeader
        title="Guest Access"
        description={`${pendingCount} request${pendingCount !== 1 ? 's' : ''} pending review`}
      />

      {/* Filter */}
      <div className="flex gap-2 mb-5">
        {(['pending', 'approved', 'denied', 'all'] as const).map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
              filter === s
                ? 'bg-green-900 text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {s} <span className="opacity-60">({requests.filter(r => s === 'all' || r.status === s).length})</span>
          </button>
        ))}
      </div>

      <AdminTable
        headers={['Member', 'Destination', 'Visit dates', 'Reason', 'Submitted', 'Status', 'Actions']}
        empty={loading ? 'Loading…' : filtered.length === 0 ? 'No requests in this category.' : undefined}
      >
        {filtered.map(r => (
          <AdminTr key={r.id}>
            <AdminTd>
              <p className="font-medium text-gray-900">
                {r.requesting_member?.first_name} {r.requesting_member?.last_name}
              </p>
              <p className="text-xs text-gray-400">{r.requesting_member?.profile?.role_title}</p>
              <p className="text-xs text-gray-400">{r.requesting_member?.profile?.business_name}</p>
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
              <p className="text-xs text-gray-600 max-w-xs">{r.reason}</p>
            </AdminTd>
            <AdminTd>
              <span className="text-xs text-gray-400">{formatRelativeTime(r.created_at)}</span>
            </AdminTd>
            <AdminTd>
              <GuestBadge status={r.status} />
            </AdminTd>
            <AdminTd>
              {r.status === 'pending' && (
                <div className="flex gap-1.5" onClick={e => e.stopPropagation()}>
                  <AdminButton
                    label="✓ Approve"
                    onClick={() => decide(r.id, 'approved', r)}
                    variant="gold"
                    size="sm"
                    disabled={processing === r.id}
                  />
                  <AdminButton
                    label="✕ Deny"
                    onClick={() => decide(r.id, 'denied', r)}
                    variant="danger"
                    size="sm"
                    disabled={processing === r.id}
                  />
                </div>
              )}
            </AdminTd>
          </AdminTr>
        ))}
      </AdminTable>
    </div>
  )
}

function GuestBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; colour: 'yellow' | 'green' | 'red' | 'gray' }> = {
    pending:  { label: 'Pending',  colour: 'yellow' },
    approved: { label: 'Approved', colour: 'green' },
    denied:   { label: 'Denied',   colour: 'red' },
  }
  const s = map[status] ?? { label: status, colour: 'gray' as const }
  return <Badge label={s.label} colour={s.colour} />
}
