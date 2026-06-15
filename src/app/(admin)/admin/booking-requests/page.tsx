'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase'
import { AdminPageHeader, AdminTable, AdminTr, AdminTd, AdminButton } from '@/components/admin/AdminUI'
import { formatBookingDate, formatTeeTime, formatRelativeTime } from '@/lib/utils'
import type { AdditionalPlayer } from '@/types'

interface BookingRequestRow {
  id: string
  member_id: string
  booking_date: string
  tee_time: string
  guest_name: string | null
  additional_players: AdditionalPlayer[] | null
  created_at: string
  booker: {
    id: string
    first_name: string
    last_name: string
    email: string
    profile: { business_name: string | null; role_title: string | null } | null
  } | null
}

export default function AdminBookingRequestsPage() {
  const [requests, setRequests] = useState<BookingRequestRow[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  useEffect(() => { loadRequests() }, [])

  async function loadRequests() {
    const supabase = createClient()
    const { data } = await supabase
      .from('bookings')
      .select(`
        id, member_id, booking_date, tee_time, guest_name, additional_players, created_at,
        booker:members!member_id(
          id, first_name, last_name, email,
          profile:member_profiles(business_name, role_title)
        )
      `)
      .eq('status', 'awaiting_approval')
      .order('created_at', { ascending: false })
    setRequests((data ?? []) as unknown as BookingRequestRow[])
    setLoading(false)
  }

  async function decide(id: string, action: 'setup' | 'reject') {
    setProcessing(id)
    const res = await fetch(`/api/admin/booking-requests/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    if (res.ok) {
      showToast(action === 'setup' ? 'Guest set up, booked, and synced.' : 'Guest request rejected.')
      // Remove the actioned row locally; it's no longer awaiting approval.
      setRequests(prev => prev.filter(r => r.id !== id))
    } else {
      const data = await res.json().catch(() => ({}))
      showToast(data.error ?? 'Action failed. Please try again.', false)
    }
    setProcessing(null)
  }

  // Count of pending requests per booker (repeat-booker visibility)
  const bookerCounts = useMemo(() => {
    const map: Record<string, number> = {}
    requests.forEach(r => { map[r.member_id] = (map[r.member_id] ?? 0) + 1 })
    return map
  }, [requests])

  return (
    <div className="p-4 sm:p-8">
      <AdminPageHeader
        title="Booking Requests"
        description={`${requests.length} non-member guest${requests.length !== 1 ? 's' : ''} awaiting setup`}
      />

      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium transition-all ${
          toast.ok ? 'bg-green-900 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.msg}
        </div>
      )}

      <AdminTable
        headers={['Booker', 'Guest', 'Contact', 'Tee time', 'Submitted', 'Actions']}
        empty={loading ? 'Loading…' : requests.length === 0 ? 'No non-member guests awaiting approval.' : undefined}
      >
        {requests.map(r => {
          const guest = r.additional_players?.[0]
          const guestName =
            [guest?.firstName, guest?.lastName].filter(Boolean).join(' ').trim() ||
            r.guest_name ||
            '—'
          const isProcessingThis = processing === r.id
          const totalRequests = bookerCounts[r.member_id] ?? 1

          return (
            <AdminTr key={r.id}>
              <AdminTd>
                <p className="font-medium text-gray-900 capitalize">
                  {r.booker?.first_name ?? ''} {r.booker?.last_name ?? ''}
                </p>
                <p className="text-xs text-gray-400">{r.booker?.profile?.role_title}</p>
                <p className="text-xs text-gray-400">{r.booker?.profile?.business_name}</p>
                {totalRequests > 1 && (
                  <p className="text-xs text-blue-500 mt-0.5">{totalRequests} guests this round</p>
                )}
              </AdminTd>
              <AdminTd>
                <p className="text-sm text-gray-700 capitalize">{guestName}</p>
                <p className="text-xs text-gray-400">Non-member</p>
              </AdminTd>
              <AdminTd>
                <p className="text-xs text-gray-600">{guest?.email ?? '—'}</p>
                <p className="text-xs text-gray-400">{guest?.mobile ?? '—'}</p>
              </AdminTd>
              <AdminTd>
                <p className="text-xs text-gray-600">
                  {formatBookingDate(r.booking_date)}<br />{formatTeeTime(r.tee_time)}
                </p>
              </AdminTd>
              <AdminTd>
                <span className="text-xs text-gray-400">{formatRelativeTime(r.created_at)}</span>
              </AdminTd>
              <AdminTd>
                <div className="flex gap-1.5 flex-wrap" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()} role="presentation">
                  <AdminButton
                    label="Setup"
                    onClick={() => decide(r.id, 'setup')}
                    variant="gold"
                    size="sm"
                    disabled={isProcessingThis}
                  />
                  <AdminButton
                    label="✕ Reject"
                    onClick={() => decide(r.id, 'reject')}
                    variant="danger"
                    size="sm"
                    disabled={isProcessingThis}
                  />
                </div>
              </AdminTd>
            </AdminTr>
          )
        })}
      </AdminTable>
    </div>
  )
}
