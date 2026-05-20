'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { useAuthStore } from '@/store/auth'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  {
    href: '/home',
    label: 'Home',
    icon: (active: boolean) => (
      <svg viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'}
        stroke="currentColor" strokeWidth={active ? 0 : 1.5} className="w-6 h-6 md:w-5 md:h-5">
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M2.25 12l8.954-8.955a1.126 1.126 0 011.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
      </svg>
    ),
  },
  {
    href: '/members',
    label: 'Members',
    icon: (active: boolean) => (
      <svg viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'}
        stroke="currentColor" strokeWidth={active ? 0 : 1.5} className="w-6 h-6 md:w-5 md:h-5">
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
      </svg>
    ),
  },
  {
    href: '/messages',
    label: 'Messages',
    icon: (active: boolean) => (
      <svg viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'}
        stroke="currentColor" strokeWidth={active ? 0 : 1.5} className="w-6 h-6 md:w-5 md:h-5">
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
      </svg>
    ),
  },
  {
    href: '/book',
    label: 'Book',
    icon: (active: boolean) => (
      <svg viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'}
        stroke="currentColor" strokeWidth={active ? 0 : 1.5} className="w-6 h-6 md:w-5 md:h-5">
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
      </svg>
    ),
  },
  {
    href: '/more',
    label: 'More',
    icon: (active: boolean) => (
      <svg viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'}
        stroke="currentColor" strokeWidth={active ? 0 : 1.5} className="w-6 h-6 md:w-5 md:h-5">
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
      </svg>
    ),
  },
]

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="app-shell">

      {/* ---- Sidebar (tablet+) ---- */}
      <aside className="app-sidebar">
        {/* Logo */}
        <div className="sidebar-logo">
          <div className="font-display text-2xl" style={{ color: 'var(--color-gold)' }}>
            LinkUp Golf
          </div>
          <p className="text-xs uppercase tracking-widest mt-0.5" style={{ color: 'rgba(255,255,255,0.3)' }}>
            Member Portal
          </p>
        </div>

        {/* Nav items */}
        <nav className="flex flex-col gap-0.5 py-3 flex-1">
          {NAV_ITEMS.map(item => {
            const active = pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn('sidebar-nav-item', active && 'active')}
                aria-current={active ? 'page' : undefined}
              >
                {item.icon(active)}
                <span>{item.label}</span>
              </Link>
            )
          })}
        </nav>

        {/* Bottom of sidebar */}
        <div className="px-5 py-4 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.2)' }}>
            Park Hyatt Aviara
          </p>
        </div>
      </aside>

      {/* ---- Content column ---- */}
      <div className="app-content-col">
        <main className="screen-content">
          {children}
        </main>

        {/* Bottom navigation (mobile only — hidden on md+) */}
        <nav className="bottom-nav">
          <div className="flex">
            {NAV_ITEMS.map(item => {
              const active = pathname.startsWith(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn('nav-item', active && 'active')}
                  aria-label={item.label}
                  aria-current={active ? 'page' : undefined}
                >
                  {item.icon(active)}
                </Link>
              )
            })}
          </div>
        </nav>
      </div>

    </div>
  )
}
