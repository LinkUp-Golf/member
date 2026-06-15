'use client'

import { useEffect, useState, useCallback } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { useProfile } from '@/hooks/useProfile'
import { createClient } from '@/lib/supabase'
import { COURSE_SLUGS } from '@/lib/ghl/tags'
import { cn } from '@/lib/utils'
import { FullScreenLoader } from '@/components/ui/Loading'

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
      { href: '/admin/members',          label: 'Members',           icon: '▪' },
      { href: '/admin/moderation',       label: 'Moderation Queue',  icon: '▪', badge: true },
      { href: '/admin/guest-access',     label: 'Guest Access',      icon: '▪', badge: true },
      { href: '/admin/referrals',        label: 'Referral Pipeline', icon: '▪' },
      { href: '/admin/messaging',        label: 'Messaging Controls', icon: '▪' },
    ],
  },
  {
    label: 'Golf',
    items: [
      { href: '/admin/bookings',         label: 'Booking Overview',  icon: '▪' },
      { href: '/admin/booking-requests', label: 'Booking Requests',  icon: '▪', badge: true },
      { href: '/admin/focus-linkups',    label: 'Focus LinkUps',     icon: '▪' },
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
  pendingCount,
  guestCount,
  bookingReqCount,
  user,
  onNavigate,
}: {
  pathname: string
  pendingCount: number
  guestCount: number
  bookingReqCount: number
  user: { email: string }
  onNavigate?: () => void
}) {
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
          <div className="font-serif text-base font-medium" style={{ color: '#85bb65' }}>
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
                ? item.href.includes('moderation')
                  ? pendingCount
                  : item.href.includes('guest')
                  ? guestCount
                  : item.href.includes('booking-requests')
                  ? bookingReqCount
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
  const [pendingCount, setPendingCount] = useState(0)
  const [guestCount, setGuestCount] = useState(0)
  const [bookingReqCount, setBookingReqCount] = useState(0)
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
    const { data: courses } = await supabase
      .from('courses')
      .select('id')
      .in('slug', COURSE_SLUGS)
    if (!courses?.length) return
    const courseIds = courses.map(c => c.id)
    const [modRes, guestRes, bookingReqRes] = await Promise.all([
      supabase.from('announcements').select('id', { count: 'exact', head: true })
        .in('course_id', courseIds).eq('status', 'pending_review'),
      supabase.from('guest_access_requests').select('id', { count: 'exact', head: true })
        .in('target_course_id', courseIds).eq('status', 'pending'),
      supabase.from('bookings').select('id', { count: 'exact', head: true })
        .in('course_id', courseIds).eq('status', 'awaiting_approval'),
    ])
    setPendingCount(modRes.count ?? 0)
    setGuestCount(guestRes.count ?? 0)
    setBookingReqCount(bookingReqRes.count ?? 0)
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
          pendingCount={pendingCount}
          guestCount={guestCount}
          bookingReqCount={bookingReqCount}
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
              pendingCount={pendingCount}
              guestCount={guestCount}
              bookingReqCount={bookingReqCount}
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
