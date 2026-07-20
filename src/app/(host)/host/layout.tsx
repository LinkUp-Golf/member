'use client'

// The host workspace shell — desktop sidebar mirroring admin, mobile bottom tab
// bar mirroring the member app. Same structure as the referral-partner
// workspace. Middleware is the real gate (HOST_ROUTES in src/middleware.ts);
// the check here only avoids flashing the shell to someone mid-redirect.

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { motion } from 'framer-motion'
import { LayoutDashboard, CalendarDays, Wallet, ChevronLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FullScreenLoader } from '@/components/ui/Loading'
import { useMemberRoles } from '@/hooks/useMemberRoles'

const NAV_ITEMS = [
  { href: '/host',         label: 'Overview',  short: 'Overview', icon: LayoutDashboard },
  { href: '/host/events',  label: 'My Events', short: 'Events',   icon: CalendarDays },
  { href: '/host/credits', label: 'Credits',   short: 'Credits',  icon: Wallet },
]

// '/host' is a prefix of every other route, so it only matches exactly.
function isActive(pathname: string, href: string) {
  return href === '/host' ? pathname === '/host' : pathname.startsWith(href)
}

export default function HostLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { isHost, loading } = useMemberRoles()

  useEffect(() => {
    if (!loading && !isHost) router.push('/more/host')
  }, [loading, isHost, router])

  if (loading) return <FullScreenLoader />
  if (!isHost) return null

  const current = NAV_ITEMS.find(i => isActive(pathname, i.href))

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* ---- Desktop sidebar ---------------------------------- */}
      <aside className="hidden md:flex md:w-56 lg:w-60 bg-green-950 flex-col flex-shrink-0 h-screen overflow-hidden sticky top-0">
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
              Host
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 overflow-y-auto">
          {NAV_ITEMS.map(item => {
            const active = isActive(pathname, item.href)
            const ItemIcon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm mb-0.5 transition-colors',
                  active
                    ? 'bg-white/10 text-white font-medium'
                    : 'text-white/55 hover:text-white hover:bg-white/[0.06]'
                )}
              >
                <ItemIcon className="w-4 h-4 flex-shrink-0" strokeWidth={1.9} />
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="px-4 py-3 border-t border-white/[0.07]">
          <Link href="/home" className="text-xs text-white/40 hover:text-white/70 transition-colors">
            ← Back to LinkUp
          </Link>
        </div>
      </aside>

      <div className="flex-1 min-w-0">
        {/* ---- Mobile header ---------------------------------- */}
        <header
          className="md:hidden sticky top-0 z-30 bg-green-950 px-4 py-3 flex items-center gap-3"
          style={{ paddingTop: 'calc(0.75rem + var(--safe-top, 0px))' }}
        >
          <Link
            href="/home"
            aria-label="Back to LinkUp"
            className="focus-ring -ml-1 p-1 rounded-lg text-white/50 hover:text-white transition-colors"
          >
            <ChevronLeft className="w-5 h-5" strokeWidth={2} />
          </Link>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-widest text-white/35 leading-none">
              Host
            </p>
            <p className="text-sm font-semibold text-white leading-tight mt-1 truncate">
              {current?.label ?? 'Overview'}
            </p>
          </div>
        </header>

        {/* Bottom padding on mobile so content clears the fixed tab bar. */}
        <div className="pb-[calc(var(--safe-bottom,0px)+72px)] md:pb-0">
          {children}
        </div>

        {/* ---- Mobile bottom tabs ----------------------------- */}
        <nav className="bottom-nav" aria-label="Host sections">
          <div className="flex">
            {NAV_ITEMS.map(item => {
              const active = isActive(pathname, item.href)
              const ItemIcon = item.icon
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn('nav-item focus-ring', active && 'active')}
                  aria-label={item.label}
                  aria-current={active ? 'page' : undefined}
                >
                  <motion.div
                    className="relative flex flex-col items-center gap-1"
                    whileTap={{ scale: 0.88 }}
                  >
                    {active && (
                      <motion.div
                        layoutId="host-bottom-nav-pill"
                        className="absolute -inset-x-3.5 -inset-y-1.5 rounded-2xl -z-10"
                        style={{ background: 'rgba(133,187,101,0.16)' }}
                        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                      />
                    )}
                    <ItemIcon className="w-5 h-5" strokeWidth={1.9} />
                    <span className="nav-label">{item.short}</span>
                  </motion.div>
                </Link>
              )
            })}
          </div>
        </nav>
      </div>
    </div>
  )
}
