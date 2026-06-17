'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import Icon from '@/components/ui/Icon'
import NotificationBell from '@/components/ui/NotificationBell'

const NAV_ITEMS = [
  { href: '/home',     label: 'Home',     icon: 'home'     },
  { href: '/members',  label: 'Members',  icon: 'members'  },
  { href: '/messages', label: 'Messages', icon: 'messages' },
  { href: '/book',     label: 'Book',     icon: 'book'     },
  { href: '/more',     label: 'More',     icon: 'more'     },
] as const

// Messages moves to the top-bar header on mobile; bottom nav shows 4 items
const BOTTOM_NAV_ITEMS = NAV_ITEMS.filter(i => i.href !== '/messages')

// Sidebar (tablet+) and bottom nav (mobile) — both need usePathname for
// active-state highlighting, so this is the minimal client boundary.
export default function AppNav({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="app-shell">
      {/* Sidebar — tablet+ */}
      <aside className="app-sidebar">
        <div className="sidebar-logo px-6 py-4">
          <div>
            <div className="font-sans text-base leading-none font-semibold" style={{ color: 'var(--color-gold)' }}>
              LinkUp Golf
            </div>
            <p className="text-[11px] uppercase tracking-widest mt-1" style={{ color: 'rgba(255,255,255,0.28)' }}>
              Member Portal
            </p>
          </div>
        </div>

        <nav className="flex flex-col gap-px py-4 flex-1">
          {NAV_ITEMS.map(item => {
            const active = pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn('sidebar-nav-item', active && 'active')}
                aria-current={active ? 'page' : undefined}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </Link>
            )
          })}
        </nav>

        <div
          className="px-4 py-3 border-t flex items-center justify-between"
          style={{ borderColor: 'rgba(255,255,255,0.07)' }}
        >
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.18)' }}>
            Park Hyatt Aviara
          </p>
          <NotificationBell variant="light" />
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
            {BOTTOM_NAV_ITEMS.map(item => {
              const active = pathname.startsWith(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn('nav-item', active && 'active')}
                  aria-label={item.label}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon name={item.icon} className="w-6 h-6" />
                  <span className="nav-label">{item.label}</span>
                </Link>
              )
            })}
          </div>
        </nav>
      </div>
    </div>
  )
}
