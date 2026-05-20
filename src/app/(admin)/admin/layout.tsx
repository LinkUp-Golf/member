'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuthStore } from '@/store/auth'
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
    ],
  },
  {
    label: 'Golf',
    items: [
      { href: '/admin/bookings',         label: 'Booking Overview',  icon: '▪' },
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
  user,
  onNavigate,
}: {
  pathname: string
  pendingCount: number
  guestCount: number
  user: { email: string }
  onNavigate?: () => void
}) {
  return (
    <>
      {/* Logo */}
      <div className="px-5 py-6 border-b border-white/[0.08]">
        <div className="font-serif text-xl italic" style={{ color: '#85bb65' }}>
          LinkUp Golf
        </div>
        <div className="text-xs uppercase tracking-widest text-white/30 mt-1">
          Admin Panel
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
  const { user, initialized, initialize } = useAuthStore()
  const router = useRouter()
  const pathname = usePathname()
  const [pendingCount] = useState(0)
  const [guestCount] = useState(0)
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    if (!initialized) initialize()
  }, [initialized, initialize])

  useEffect(() => {
    if (initialized && (!user || !user.isAdmin)) {
      router.push('/home')
    }
  }, [user, initialized, router])

  // Close drawer on route change
  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname])

  if (!initialized || !user) return <FullScreenLoader />

  return (
    <div className="flex h-screen bg-gray-50 font-sans">
      {/* ---- Desktop sidebar ---------------------------------- */}
      <aside className="hidden md:flex md:w-56 lg:w-60 bg-green-950 flex-col flex-shrink-0 h-screen overflow-hidden">
        <NavContent
          pathname={pathname}
          pendingCount={pendingCount}
          guestCount={guestCount}
          user={user}
        />
      </aside>

      {/* ---- Mobile drawer overlay ---------------------------- */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setDrawerOpen(false)}
          />
          {/* Drawer panel */}
          <aside className="absolute left-0 top-0 bottom-0 w-72 bg-green-950 flex flex-col shadow-2xl">
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
              user={user}
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

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
