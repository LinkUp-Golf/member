'use client'

// The referral-partner workspace shell.
//
// Desktop mirrors the admin sidebar so the two workspaces feel like one
// system. Mobile deliberately follows the *member* app instead — a fixed
// bottom tab bar (the shared .bottom-nav / .nav-item styles, safe-area
// insets included) rather than a row of pills at the top. Partners reach this
// from the member app on a phone, so thumb-reachable tabs are the familiar
// shape; the previous horizontal strip scrolled, gave no active state worth
// the name, and sat at the far end of the screen from the thumb.
//
// Middleware is the real gate (PARTNER_ROUTES in src/middleware.ts); the check
// here only avoids flashing the shell to someone mid-redirect.

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { motion } from 'framer-motion'
import { LayoutDashboard, Users, Upload, Wallet, Coins, ChevronLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FullScreenLoader } from '@/components/ui/Loading'
import { useMemberRoles } from '@/hooks/useMemberRoles'
import { useProfile } from '@/hooks/useProfile'
import WorkspaceSwitcher from '@/components/layout/WorkspaceSwitcher'

const NAV_ITEMS = [
  { href: '/partner',             label: 'Overview',  short: 'Overview', icon: LayoutDashboard },
  { href: '/partner/referrals',   label: 'My Referrals', short: 'Referrals', icon: Users },
  { href: '/partner/submissions', label: 'Submit Referrals', short: 'Submit', icon: Upload },
  { href: '/partner/payments',    label: 'Payments',  short: 'Payments', icon: Wallet },
  { href: '/partner/credits',     label: 'Credits',   short: 'Credits', icon: Coins },
]

// '/partner' is a prefix of every other route, so it only matches exactly.
function isActive(pathname: string, href: string) {
  return href === '/partner' ? pathname === '/partner' : pathname.startsWith(href)
}

export default function PartnerLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { isPartner, loading } = useMemberRoles()
  const { profile } = useProfile()
  // A non-member has no member app to go 'back' to — hide that link for them.
  const isMember = !!profile?.home_course_id

  useEffect(() => {
    if (!loading && !isPartner) router.push('/more/referral-partner')
  }, [loading, isPartner, router])

  if (loading) return <FullScreenLoader />
  if (!isPartner) return null

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
          <div className="font-sans text-base font-semibold" style={{ color: '#85bb65' }}>
            LinkUp Golf
          </div>
        </div>

        {/* Workspace switcher — for users who hold more than one workspace. */}
        <div className="px-3 py-3 border-b border-white/[0.06]">
          <WorkspaceSwitcher current="partner" />
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

        {isMember && (
          <div className="px-4 py-3 border-t border-white/[0.07]">
            <Link href="/home" className="text-xs text-white/40 hover:text-white/70 transition-colors">
              ← Back to LinkUp
            </Link>
          </div>
        )}
      </aside>

      <div className="flex-1 min-w-0">
        {/* ---- Mobile header ---------------------------------- */}
        <header
          className="md:hidden sticky top-0 z-30 bg-green-950 px-4 py-3 flex items-center gap-2"
          style={{ paddingTop: 'calc(0.75rem + var(--safe-top, 0px))' }}
        >
          {isMember && (
            <Link
              href="/home"
              aria-label="Back to LinkUp"
              className="focus-ring -ml-1 p-1 rounded-lg text-white/50 hover:text-white transition-colors flex-shrink-0"
            >
              <ChevronLeft className="w-5 h-5" strokeWidth={2} />
            </Link>
          )}
          <div className="min-w-0 flex-1">
            <WorkspaceSwitcher current="partner" />
          </div>
        </header>

        {/* Bottom padding on mobile so content clears the fixed tab bar.
            Content is centred and capped here rather than per page, matching
            the admin shell. */}
        <div className="pb-[calc(var(--safe-bottom,0px)+72px)] md:pb-0">
          <div className="max-w-6xl mx-auto">
            {children}
          </div>
        </div>

        {/* ---- Mobile bottom tabs ----------------------------- */}
        <nav className="bottom-nav" aria-label="Referral partner sections">
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
                        layoutId="partner-bottom-nav-pill"
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
