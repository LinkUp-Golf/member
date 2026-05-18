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
      { href: '/admin',                 label: 'Dashboard',        icon: '◻' },
    ],
  },
  {
    label: 'Community',
    items: [
      { href: '/admin/members',         label: 'Members',          icon: '◻' },
      { href: '/admin/moderation',      label: 'Moderation Queue', icon: '◻', badge: true },
      { href: '/admin/guest-access',    label: 'Guest Access',     icon: '◻', badge: true },
      { href: '/admin/referrals',       label: 'Referral Pipeline',icon: '◻' },
    ],
  },
  {
    label: 'Golf',
    items: [
      { href: '/admin/bookings',        label: 'Booking Overview', icon: '◻' },
      { href: '/admin/focus-linkups',   label: 'Focus LinkUps',    icon: '◻' },
    ],
  },
  {
    label: 'Content',
    items: [
      { href: '/admin/promotions',      label: 'Promotions',       icon: '◻' },
      { href: '/admin/announcements',   label: 'Announcements',    icon: '◻' },
    ],
  },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, initialized, initialize } = useAuthStore()
  const router = useRouter()
  const pathname = usePathname()
  const [pendingCount, setPendingCount] = useState(0)
  const [guestCount, setGuestCount] = useState(0)

  useEffect(() => {
    if (!initialized) initialize()
  }, [initialized, initialize])

  useEffect(() => {
    if (initialized && (!user || !user.isAdmin)) {
      router.push('/home')
    }
  }, [user, initialized, router])

  if (!initialized || !user) return <FullScreenLoader />

  return (
    <div className="flex h-screen bg-gray-50 font-sans">
      {/* Sidebar */}
      <aside className="w-60 bg-green-950 flex flex-col flex-shrink-0 h-screen overflow-y-auto">
        {/* Logo */}
        <div className="px-5 py-6 border-b border-white/08">
          <div className="font-serif text-xl italic" style={{ color: '#85bb65' }}>
            LinkUp Golf
          </div>
          <div className="text-xs uppercase tracking-widest text-white/30 mt-1">
            Admin Panel
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4">
          {NAV_GROUPS.map(group => (
            <div key={group.label} className="mb-5">
              <p className="text-xs uppercase tracking-widest text-white/25 px-2 mb-2">
                {group.label}
              </p>
              {group.items.map(item => {
                const active = pathname === item.href ||
                  (item.href !== '/admin' && pathname.startsWith(item.href))
                const count = item.badge
                  ? item.href.includes('moderation') ? pendingCount
                  : item.href.includes('guest') ? guestCount
                  : 0
                  : 0

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'flex items-center justify-between px-3 py-2 rounded-lg text-sm mb-0.5 transition-colors',
                      active
                        ? 'bg-white/10 text-white font-medium'
                        : 'text-white/55 hover:text-white hover:bg-white/06'
                    )}
                  >
                    <span>{item.label}</span>
                    {count > 0 && (
                      <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full"
                        style={{ background: '#85bb65', color: '#002669' }}>
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
        <div className="px-5 py-4 border-t border-white/08">
          <p className="text-xs text-white/30">{user.email}</p>
          <Link href="/home" className="text-xs text-white/40 hover:text-white/70 mt-1 block">
            ← Back to member app
          </Link>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  )
}
