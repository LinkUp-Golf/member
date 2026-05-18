'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { AdminPageHeader, StatCard, AdminTable, AdminTr, AdminTd, ProgressBar, AdminCard } from '@/components/admin/AdminUI'
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns'
import { formatTeeTime } from '@/lib/utils'

export default function AdminBookingsPage() {
  const [bookings, setBookings] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [month, setMonth] = useState(new Date())
  const [courseData, setCourseData] = useState<any>(null)

  useEffect(() => { loadBookings() }, [month])

  async function loadBookings() {
    setLoading(true)
    const supabase = createClient()
    const monthStart = format(startOfMonth(month), 'yyyy-MM-dd')
    const monthEnd = format(endOfMonth(month), 'yyyy-MM-dd')

    const { data: course } = await supabase
      .from('courses')
      .select('id, max_rounds_per_month, reserved_rounds')
      .eq('slug', 'aviara')
      .single()

    setCourseData(course)

    const { data } = await supabase
      .from('bookings')
      .select('*, member:members(first_name, last_name, email)')
      .eq('course_id', course?.id)
      .neq('status', 'cancelled')
      .gte('booking_date', monthStart)
      .lte('booking_date', monthEnd)
      .order('booking_date', { ascending: false })

    setBookings(data ?? [])
    setLoading(false)
  }

  const confirmed = bookings.filter(b => b.status === 'confirmed').length
  const withGuest = bookings.filter(b => b.guest_name).length
  const revenue = bookings.filter(b => b.status === 'confirmed').reduce((sum, b) => sum + Number(b.amount_charged), 0)
  const memberAlloc = courseData ? courseData.max_rounds_per_month - courseData.reserved_rounds : 200

  return (
    <div className="p-8 max-w-6xl">
      <AdminPageHeader
        title="Booking Overview"
        subtitle="Park Hyatt Aviara"
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMonth(subMonths(month, 1))}
              className="px-3 py-1.5 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              ←
            </button>
            <span className="text-sm font-medium text-gray-700 w-32 text-center">
              {format(month, 'MMMM yyyy')}
            </span>
            <button
              onClick={() => setMonth(m => {
                const next = new Date(m)
                next.setMonth(m.getMonth() + 1)
                return next
              })}
              disabled={month >= new Date()}
              className="px-3 py-1.5 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40"
            >
              →
            </button>
          </div>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard label="Confirmed rounds" value={confirmed} sub={`of ${memberAlloc} member allocation`} colour="green" />
        <StatCard label="Rounds with guest" value={withGuest} sub="Non-member guests brought" colour="blue" />
        <StatCard label="Revenue" value={`$${revenue.toLocaleString()}`} sub="Member round payments" colour="green" />
        <StatCard label="Reserved pool" value={courseData?.reserved_rounds ?? 0} sub="Held for NBD + events" colour="gray" />
      </div>

      {/* Capacity bar */}
      <AdminCard title={`Round utilisation — ${format(month, 'MMMM yyyy')}`}>
        <ProgressBar value={confirmed} max={memberAlloc} />
        <div className="grid grid-cols-3 gap-4 mt-4 text-sm">
          <div className="text-center">
            <p className="text-2xl font-bold text-green-700">{confirmed}</p>
            <p className="text-xs text-gray-400">Member rounds booked</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-gray-400">{memberAlloc - confirmed}</p>
            <p className="text-xs text-gray-400">Remaining</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-gray-400">{courseData?.reserved_rounds ?? 0}</p>
            <p className="text-xs text-gray-400">Reserved (NBD + events)</p>
          </div>
        </div>
      </AdminCard>

      {/* Booking list */}
      <div className="mt-6">
        <AdminTable
          headers={['Member', 'Date', 'Tee time', 'Players', 'Guest', 'Amount', 'Status']}
          empty={loading ? 'Loading…' : bookings.length === 0 ? 'No bookings this month.' : undefined}
        >
          {bookings.map(b => (
            <AdminTr key={b.id}>
              <AdminTd>
                <p className="font-medium text-gray-900">{b.member?.first_name} {b.member?.last_name}</p>
                <p className="text-xs text-gray-400">{b.member?.email}</p>
              </AdminTd>
              <AdminTd>{format(new Date(b.booking_date + 'T12:00:00'), 'EEE, MMM d')}</AdminTd>
              <AdminTd>{formatTeeTime(b.tee_time)}</AdminTd>
              <AdminTd>{b.players}</AdminTd>
              <AdminTd>{b.guest_name ?? <span className="text-gray-300">—</span>}</AdminTd>
              <AdminTd className="font-medium text-green-700">${Number(b.amount_charged).toFixed(0)}</AdminTd>
              <AdminTd>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  b.status === 'confirmed' ? 'bg-green-50 text-green-700' :
                  b.status === 'pending'   ? 'bg-yellow-50 text-yellow-700' :
                  'bg-gray-100 text-gray-500'
                }`}>
                  {b.status}
                </span>
              </AdminTd>
            </AdminTr>
          ))}
        </AdminTable>
      </div>
    </div>
  )
}
