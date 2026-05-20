'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { cn } from '@/lib/utils'

// Icons use stroke-only paths throughout — no fill toggling.
// Active state is communicated via the pill background, not icon shape.
const NAV_ITEMS = [
  {
    href: '/home',
    label: 'Home',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
        strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 md:w-5 md:h-5">
        <path d="M3 12L12 3L21 12" />
        <path d="M5 10V20C5 20.552 5.448 21 6 21H9V16C9 15.448 9.448 15 10 15H14C14.552 15 15 15.448 15 16V21H18C18.552 21 19 20.552 19 20V10" />
      </svg>
    ),
  },
  {
    href: '/members',
    label: 'Members',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
        strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 md:w-5 md:h-5">
        <circle cx="9" cy="7" r="3" />
        <path d="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2" />
        <path d="M16 3.13a4 4 0 010 7.75" />
        <path d="M21 21v-2a4 4 0 00-3-3.85" />
      </svg>
    ),
  },
  {
    href: '/messages',
    label: 'Messages',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
        strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 md:w-5 md:h-5">
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
      </svg>
    ),
  },
  {
    href: '/book',
    label: 'Book',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
        strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 md:w-5 md:h-5">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
  {
    href: '/more',
    label: 'More',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
        strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 md:w-5 md:h-5">
        <circle cx="12" cy="5" r="1" fill="currentColor" stroke="none" />
        <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
        <circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
]

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="app-shell">

      {/* Sidebar — tablet+ */}
      <aside className="app-sidebar">
        <div className="sidebar-logo">
          <div className="font-display text-2xl" style={{ color: 'var(--color-gold)' }}>
            LinkUp Golf
          </div>
          <p className="text-xs uppercase tracking-widest mt-0.5" style={{ color: 'rgba(255,255,255,0.3)' }}>
            Member Portal
          </p>
        </div>

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
                {item.icon}
                <span>{item.label}</span>
              </Link>
            )
          })}
        </nav>

        <div className="px-5 py-4 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.2)' }}>
            Park Hyatt Aviara
          </p>
        </div>
      </aside>

      {/* Content column */}
      <div className="app-content-col">
        <main className="screen-content">
          {children}
        </main>

        {/* Bottom nav — mobile only */}
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
                  <span className={cn(
                    'flex items-center justify-center w-10 h-10 rounded-2xl transition-all duration-200',
                    active && 'bg-white/10'
                  )}>
                    {item.icon}
                  </span>
                </Link>
              )
            })}
          </div>
        </nav>
      </div>

    </div>
  )
}
