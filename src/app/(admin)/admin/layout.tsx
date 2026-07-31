'use client'

import { useEffect, useState, useCallback } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { useProfile } from '@/hooks/useProfile'
import { createClient } from '@/lib/supabase'
import { COURSE_SLUGS } from '@/lib/ghl/tags'
import { cn } from '@/lib/utils'
import { FullScreenLoader } from '@/components/ui/Loading'
import { FEATURES } from '@/lib/features'

const NAV_GROUPS = [
  {
    label: 'Overview',
    items: [
      { href: '/admin',                  label: 'Dashboard',         icon: '▪' },
    ],
  },
  {
    label: 'Community',
    items: [
      { href: '/admin/members',          label: 'Members',            icon: '▪' },
      { href: '/admin/events',           label: 'Member Events',      icon: '▪', badge: true },
      { href: '/admin/guest-access',     label: 'Guest Access',       icon: '▪', badge: true },
      { href: '/admin/referrals',        label: 'Referral Partners',  icon: '▪', badge: true },
      { href: '/admin/hosts',            label: 'Hosts',              icon: '▪', badge: true },
      { href: '/admin/reviews',          label: 'Member Reviews',     icon: '▪' },
      { href: '/admin/messaging',        label: 'Messaging Controls', icon: '▪' },
    ],
  },
  {
    label: 'Golf',
    items: [
      { href: '/admin/golf-events',      label: 'Courses',           icon: '▪', badge: true },
      ...(FEATURES.FOCUS_LINKUPS ? [{ href: '/admin/focus-linkups', label: 'Focus LinkUps', icon: '▪' as const }] : []),
    ],
  },
  {
    label: 'Content',
    items: [
      { href: '/admin/promotions',       label: 'Promotions',        icon: '▪' },
      { href: '/admin/announcements',    label: 'Announcements',     icon: '▪' },
    ],
  },
]

function NavContent({
  pathname,
  guestCount,
  eventsCount,
  golfEventsCount,
  partnerApplicationsCount,
  hostsCount,
  activeCourses,
  user,
  onNavigate,
}: {
  pathname: string
  guestCount: number
  eventsCount: number
  golfEventsCount: number
  partnerApplicationsCount: number
  hostsCount: number
  activeCourses: { id: string; name: string }[]
  user: { email: string }
  onNavigate?: () => void
}) {
  const searchParams = useSearchParams()
  const currentCourseId = searchParams.get('courseId')
  const onBookings = pathname.startsWith('/admin/bookings')
  const [bookingsOpen, setBookingsOpen] = useState(onBookings)

  return (
    <>
      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/[0.08] flex items-center gap-3">
        <Image
          src="/linkup-golf.webp"
          alt="LinkUp Golf"
          width={36}
          height={36}
          className="rounded-lg flex-shrink-0"
          priority
        />
        <div>
          <div className="font-sans text-base font-semibold" style={{ color: '#85bb65' }}>
            LinkUp Golf
          </div>
          <div className="text-[10px] uppercase tracking-widest text-white/30 mt-0.5">
            Admin Panel
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        {NAV_GROUPS.map(group => (
          <div key={group.label} className="mb-5">
            <p className="text-xs uppercase tracking-widest text-white/25 px-2 mb-2">
              {group.label}
            </p>
            {group.items.map(item => {
              const active =
                pathname === item.href ||
                (item.href !== '/admin' && pathname.startsWith(item.href))
              const count = item.badge
                ? item.href.includes('guest')
                  ? guestCount
                  : item.href.includes('/admin/events')
                  ? eventsCount
                  : item.href.includes('golf-events')
                  ? golfEventsCount
                  : item.href.includes('referrals')
                  ? partnerApplicationsCount
                  : item.href.includes('/admin/hosts')
                  ? hostsCount
                  : 0
                : 0

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  className={cn(
                    'flex items-center justify-between px-3 py-2.5 rounded-lg text-sm mb-0.5 transition-colors',
                    active
                      ? 'bg-white/10 text-white font-medium'
                      : 'text-white/55 hover:text-white hover:bg-white/[0.06]'
                  )}
                >
                  <span>{item.label}</span>
                  {count > 0 && (
                    <span
                      className="text-xs font-semibold px-1.5 py-0.5 rounded-full"
                      style={{ background: '#85bb65', color: '#002669' }}
                    >
                      {count}
                    </span>
                  )}
                </Link>
              )
            })}

            {/* Bookings expandable group — injected into the Golf section */}
            {group.label === 'Golf' && (
              <div className="mt-0.5">
                {/* Group row: label navigates to "all bookings", chevron only expands/collapses */}
                <div
                  className={cn(
                    'flex items-center justify-between rounded-lg text-sm transition-colors',
                    onBookings && !currentCourseId ? 'bg-white/10 text-white font-medium' : 'text-white/55 hover:text-white hover:bg-white/[0.06]'
                  )}
                >
                  <Link
                    href="/admin/bookings"
                    onClick={() => { setBookingsOpen(true); onNavigate?.() }}
                    className="flex-1 px-3 py-2.5"
                  >
                    Booking Courses
                  </Link>
                  <button
                    type="button"
                    onClick={() => setBookingsOpen(v => !v)}
                    className="px-3 py-2.5"
                    aria-label={bookingsOpen ? 'Collapse booking courses list' : 'Expand booking courses list'}
                  >
                    <svg
                      className={cn('w-3.5 h-3.5 transition-transform duration-150 text-white/40', bookingsOpen ? 'rotate-180' : '')}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                  </button>
                </div>

                {/* Course list */}
                {bookingsOpen && (
                  <div className="mt-1 ml-3 border-l border-white/[0.08] pl-3 space-y-0.5">
                    {activeCourses.length === 0 && (
                      <p className="px-2 py-1.5 text-[10px] text-white/25 italic">No active courses</p>
                    )}

                    {activeCourses.map(course => {
                      const courseActive = onBookings && currentCourseId === course.id
                      return (
                        <Link
                          key={course.id}
                          href={`/admin/bookings?courseId=${course.id}`}
                          onClick={onNavigate}
                          className={cn(
                            'flex items-center gap-2 px-2 py-2 rounded-lg text-xs transition-colors min-w-0',
                            courseActive
                              ? 'bg-white/10 text-white font-medium'
                              : 'text-white/45 hover:text-white hover:bg-white/[0.06]'
                          )}
                        >
                          <span className="w-1 h-1 rounded-full flex-shrink-0" style={{ background: '#85bb65' }} />
                          <span className="truncate">{course.name}</span>
                        </Link>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-white/[0.08] flex-shrink-0">
        <p className="text-xs text-white/30 truncate">{user.email}</p>
        <Link
          href="/home"
          onClick={onNavigate}
          className="text-xs text-white/40 hover:text-white/70 mt-1 block"
        >
          ← Back to member app
        </Link>
      </div>
    </>
  )
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, profile, loading, isAdmin } = useProfile()
  const router = useRouter()
  const pathname = usePathname()
  const [guestCount, setGuestCount] = useState(0)
  const [eventsCount, setEventsCount] = useState(0)
  const [golfEventsCount, setGolfEventsCount] = useState(0)
  const [partnerApplicationsCount, setPartnerApplicationsCount] = useState(0)
  const [hostsCount, setHostsCount] = useState(0)
  const [activeCourses, setActiveCourses] = useState<{ id: string; name: string }[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerMounted, setDrawerMounted] = useState(false)
  const [drawerVisible, setDrawerVisible] = useState(false)

  useEffect(() => {
    if (loading) return
    // Not authenticated → always redirect
    if (!user) { router.push('/home'); return }
    // Profile loaded and confirmed not admin → redirect.
    // If profile is null (fetch error) we stay put — don't kick valid admins
    // because of a transient DB error.
    if (profile !== null && !isAdmin) { router.push('/home') }
  }, [user, profile, loading, isAdmin, router])

  const fetchCounts = useCallback(async () => {
    const supabase = createClient()

    // Partner applications aren't course-scoped, so count them before the
    // course lookup below (which bails out when no LinkUp course is present).
    const { count: applicationsCount } = await supabase
      .from('referral_partner_applications')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
    setPartnerApplicationsCount(applicationsCount ?? 0)

    // Host attention badge: pending role applications + events awaiting credit
    // approval. (There's no event-review gate anymore — events publish live.)
    const [hostAppsRes, hostProofRes] = await Promise.all([
      supabase.from('host_applications').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('hosted_events').select('id', { count: 'exact', head: true }).eq('status', 'pending_credit_approval'),
    ])
    setHostsCount((hostAppsRes.count ?? 0) + (hostProofRes.count ?? 0))

    const { data: courses } = await supabase
      .from('courses')
      .select('id')
      .in('slug', COURSE_SLUGS)
    if (!courses?.length) return
    const courseIds = courses.map(c => c.id)
    const [guestRes, eventsRes, golfEventsRes] = await Promise.all([
      supabase.from('guest_access_requests').select('id', { count: 'exact', head: true })
        .in('target_course_id', courseIds).eq('status', 'pending'),
      supabase.from('member_events').select('id', { count: 'exact', head: true })
        .in('course_id', courseIds).eq('status', 'pending_review'),
      supabase.from('courses').select('id', { count: 'exact', head: true })
        .eq('approval_status', 'pending'),
    ])
    setGuestCount(guestRes.count ?? 0)
    setEventsCount(eventsRes.count ?? 0)
    setGolfEventsCount(golfEventsRes.count ?? 0)

    // Active courses for bookings nav group
    const { data: courseRows } = await supabase
      .from('courses')
      .select('id, name')
      .eq('active', true)
      .eq('approval_status', 'active')
      .order('name')
    setActiveCourses(courseRows ?? [])
  }, [])

  useEffect(() => {
    if (isAdmin) fetchCounts()
  }, [isAdmin, fetchCounts])

  // Animate drawer open/close
  useEffect(() => {
    if (drawerOpen) {
      setDrawerMounted(true)
      const ids: number[] = []
      ids[0] = requestAnimationFrame(() => {
        ids[1] = requestAnimationFrame(() => setDrawerVisible(true))
      })
      return () => ids.forEach(id => cancelAnimationFrame(id))
    } else {
      setDrawerVisible(false)
      const t = setTimeout(() => setDrawerMounted(false), 320)
      return () => clearTimeout(t)
    }
  }, [drawerOpen])

  // Close drawer on route change
  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname])

  if (loading || !user) return <FullScreenLoader />

  return (
    <div className="flex h-screen bg-gray-50 font-sans">
      {/* ---- Desktop sidebar ---------------------------------- */}
      <aside className="hidden md:flex md:w-56 lg:w-60 bg-green-950 flex-col flex-shrink-0 h-screen overflow-hidden">
        <NavContent
          pathname={pathname}
          guestCount={guestCount}
          eventsCount={eventsCount}
          golfEventsCount={golfEventsCount}
          partnerApplicationsCount={partnerApplicationsCount}
                  hostsCount={hostsCount}
          activeCourses={activeCourses}
          user={{ email: user.email ?? '' }}
        />
      </aside>

      {/* ---- Mobile drawer overlay ---------------------------- */}
      {drawerMounted && (
        <div className="fixed inset-0 z-50 md:hidden">
          {/* Backdrop */}
          <div
            className={[
              'absolute inset-0 bg-black/50',
              drawerVisible ? 'opacity-100' : 'opacity-0',
            ].join(' ')}
            style={{ transition: 'opacity 200ms ease-out', willChange: 'opacity' }}
            role="presentation"
            onClick={() => setDrawerOpen(false)}
            onKeyDown={e => { if (e.key === 'Escape') setDrawerOpen(false) }}
          />
          {/* Drawer panel */}
          <aside
            className={[
              'absolute left-0 top-0 bottom-0 w-72 bg-green-950 flex flex-col shadow-2xl',
              drawerVisible ? 'translate-x-0' : '-translate-x-full',
            ].join(' ')}
            style={{
              transition: drawerVisible
                ? 'transform 340ms cubic-bezier(0.32,0.72,0,1)'
                : 'transform 240ms cubic-bezier(0.4,0,1,1)',
              willChange: 'transform',
            }}>
            {/* Close button */}
            <button
              onClick={() => setDrawerOpen(false)}
              className="absolute top-4 right-4 text-white/40 hover:text-white/80 p-1 z-10"
              aria-label="Close menu"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <NavContent
              pathname={pathname}
              guestCount={guestCount}
              eventsCount={eventsCount}
              golfEventsCount={golfEventsCount}
              partnerApplicationsCount={partnerApplicationsCount}
                  hostsCount={hostsCount}
              activeCourses={activeCourses}
              user={{ email: user.email ?? '' }}
              onNavigate={() => setDrawerOpen(false)}
            />
          </aside>
        </div>
      )}

      {/* ---- Main area ---------------------------------------- */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile top bar */}
        <header className="md:hidden bg-green-950 px-4 py-3 flex items-center justify-between flex-shrink-0 shadow-sm">
          <button
            onClick={() => setDrawerOpen(true)}
            className="text-white/60 hover:text-white p-1 -ml-1"
            aria-label="Open menu"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <div className="font-serif text-base italic" style={{ color: '#85bb65' }}>
            LinkUp Admin
          </div>

          <Link href="/home" className="text-white/40 hover:text-white/70 text-xs">
            ← App
          </Link>
        </header>

        {/* Page content — centered, capped at max-w-6xl across all admin pages */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-6xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
