'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import {
  AdminPageHeader, StatCard, AdminCard, AdminButton,
  AdminTable, AdminTr, AdminTd, Badge, ProgressBar,
} from '@/components/admin/AdminUI'
import { formatRelativeTime } from '@/lib/utils'
import { format, startOfMonth, endOfMonth } from 'date-fns'

interface DashboardData {
  totalMembers: number
  activeMembers: number
  waitlistCount: number
  pendingCount: number
  roundsThisMonth: number
  maxRounds: number
  reservedRounds: number
  pendingModeration: number
  pendingGuestAccess: number
  recentMembers: Array<{ id: string; first_name: string; last_name: string; created_at: string; membership_status: string }>
  recentBookings: Array<{ id: string; booking_date: string; tee_time: string; amount_charged: number; member: { first_name: string; last_name: string } | null }>
}

export default function AdminDashboard() {
  const { user } = useAuthStore()
  const router = useRouter()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadDashboard()
  }, [])

  async function loadDashboard() {
    const supabase = createClient()

    // Get the Aviara course
    const { data: course } = await supabase
      .from('courses')
      .select('id, max_members, max_rounds_per_month, reserved_rounds')
      .eq('slug', 'aviara')
      .single()

    if (!course) { setLoading(false); return }

    const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd')
    const monthEnd = format(endOfMonth(new Date()), 'yyyy-MM-dd')

    const [
      membersRes, waitlistRes, pendingRes,
      roundsRes, moderationRes, guestRes,
      recentMembersRes, recentBookingsRes,
    ] = await Promise.all([
      supabase.from('members').select('id', { count: 'exact' })
        .eq('home_course_id', course.id).eq('membership_status', 'active'),
      supabase.from('members').select('id', { count: 'exact' })
        .eq('home_course_id', course.id).eq('membership_status', 'waitlist'),
      supabase.from('members').select('id', { count: 'exact' })
        .eq('home_course_id', course.id).eq('membership_status', 'pending'),
      supabase.from('bookings').select('id', { count: 'exact' })
        .eq('course_id', course.id).eq('status', 'confirmed')
        .gte('booking_date', monthStart).lte('booking_date', monthEnd),
      supabase.from('announcements').select('id', { count: 'exact' })
        .eq('course_id', course.id).eq('status', 'pending_review'),
      supabase.from('guest_access_requests').select('id', { count: 'exact' })
        .eq('target_course_id', course.id).eq('status', 'pending'),
      supabase.from('members').select('id, first_name, last_name, created_at, membership_status')
        .eq('home_course_id', course.id).order('created_at', { ascending: false }).limit(5),
      supabase.from('bookings')
        .select('id, booking_date, tee_time, amount_charged, member:members(first_name, last_name)')
        .eq('course_id', course.id).eq('status', 'confirmed')
        .order('booking_date', { ascending: false }).limit(5),
    ])

    setData({
      totalMembers: membersRes.count ?? 0,
      activeMembers: membersRes.count ?? 0,
      waitlistCount: waitlistRes.count ?? 0,
      pendingCount: pendingRes.count ?? 0,
      roundsThisMonth: roundsRes.count ?? 0,
      maxRounds: course.max_rounds_per_month - course.reserved_rounds,
      reservedRounds: course.reserved_rounds,
      pendingModeration: moderationRes.count ?? 0,
      pendingGuestAccess: guestRes.count ?? 0,
      recentMembers: recentMembersRes.data ?? [],
      recentBookings: recentBookingsRes.data as any ?? [],
    })
    setLoading(false)
  }

  if (loading || !data) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 w-48 bg-gray-200 rounded" />
          <div className="grid grid-cols-4 gap-4">
            {[1,2,3,4].map(i => <div key={i} className="h-28 bg-gray-100 rounded-xl" />)}
          </div>
        </div>
      </div>
    )
  }

  const pendingActions = data.pendingModeration + data.pendingGuestAccess + data.pendingCount

  return (
    <div className="p-8 max-w-7xl">
      <AdminPageHeader
        title="Dashboard"
        description={`Park Hyatt Aviara · ${format(new Date(), 'MMMM yyyy')}`}
      />

      {/* Pending action alert */}
      {pendingActions > 0 && (
        <div className="mb-6 bg-yellow-50 border border-yellow-200 rounded-xl px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-yellow-800">
              {pendingActions} item{pendingActions !== 1 ? 's' : ''} require your attention
            </p>
            <p className="text-xs text-yellow-600 mt-0.5">
              {data.pendingModeration > 0 && `${data.pendingModeration} moderation · `}
              {data.pendingGuestAccess > 0 && `${data.pendingGuestAccess} guest access · `}
              {data.pendingCount > 0 && `${data.pendingCount} member applications`}
            </p>
          </div>
          <AdminButton label="Review now" onClick={() => router.push('/admin/moderation')} variant="gold" />
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Active members"
          value={data.activeMembers}
          sub={`of 200 capacity · ${data.waitlistCount} waitlisted`}
          colour={data.activeMembers >= 190 ? 'red' : data.activeMembers >= 160 ? 'gold' : 'green'}
        />
        <StatCard
          label="Rounds this month"
          value={data.roundsThisMonth}
          sub={`of ${data.maxRounds} member allocation`}
          colour={data.roundsThisMonth >= data.maxRounds * 0.9 ? 'red' : 'green'}
        />
        <StatCard
          label="Pending moderation"
          value={data.pendingModeration}
          sub="Events and broadcasts awaiting review"
          colour={data.pendingModeration > 0 ? 'gold' : 'gray'}
        />
        <StatCard
          label="Guest access requests"
          value={data.pendingGuestAccess}
          sub="Travel requests awaiting approval"
          colour={data.pendingGuestAccess > 0 ? 'gold' : 'gray'}
        />
      </div>

      {/* Capacity detail */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-8">
        <AdminCard title="Membership capacity">
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-sm text-gray-600 mb-1">
                <span>Active members</span>
                <span className="font-medium">{data.activeMembers} / 200</span>
              </div>
              <ProgressBar value={data.activeMembers} max={200} />
            </div>
            <div className="grid grid-cols-3 gap-3 pt-2">
              <CapStat label="Active" value={data.activeMembers} colour="text-green-700" />
              <CapStat label="Waitlist" value={data.waitlistCount} colour="text-yellow-600" />
              <CapStat label="Pending" value={data.pendingCount} colour="text-blue-600" />
            </div>
          </div>
        </AdminCard>

        <AdminCard title="Round utilisation — this month">
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-sm text-gray-600 mb-1">
                <span>Member rounds</span>
                <span className="font-medium">{data.roundsThisMonth} / {data.maxRounds}</span>
              </div>
              <ProgressBar value={data.roundsThisMonth} max={data.maxRounds} />
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <CapStat label="Member allocation" value={data.maxRounds} colour="text-green-700" />
              <CapStat label="Reserved (NBD + events)" value={data.reservedRounds} colour="text-gray-500" />
            </div>
          </div>
        </AdminCard>
      </div>

      {/* Recent activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <AdminCard
          title="Recent members"
          action={<AdminButton label="View all" onClick={() => router.push('/admin/members')} variant="ghost" size="sm" />}
        >
          {data.recentMembers.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No members yet.</p>
          ) : (
            <div className="space-y-3">
              {data.recentMembers.map(m => (
                <div key={m.id} className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{m.first_name} {m.last_name}</p>
                    <p className="text-xs text-gray-400">{formatRelativeTime(m.created_at)}</p>
                  </div>
                  <StatusBadge status={m.membership_status} />
                </div>
              ))}
            </div>
          )}
        </AdminCard>

        <AdminCard
          title="Recent bookings"
          action={<AdminButton label="View all" onClick={() => router.push('/admin/bookings')} variant="ghost" size="sm" />}
        >
          {data.recentBookings.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No bookings yet.</p>
          ) : (
            <div className="space-y-3">
              {data.recentBookings.map((b: any) => (
                <div key={b.id} className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-800">
                      {b.member?.first_name} {b.member?.last_name}
                    </p>
                    <p className="text-xs text-gray-400">
                      {format(new Date(b.booking_date + 'T12:00:00'), 'MMM d')} · {b.tee_time?.slice(0, 5)}
                    </p>
                  </div>
                  <span className="text-sm font-medium text-green-700">
                    ${Number(b.amount_charged).toFixed(0)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </AdminCard>
      </div>
    </div>
  )
}

function CapStat({ label, value, colour }: { label: string; value: number; colour: string }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3 text-center">
      <p className={`text-2xl font-bold ${colour}`}>{value}</p>
      <p className="text-xs text-gray-400 mt-0.5">{label}</p>
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
