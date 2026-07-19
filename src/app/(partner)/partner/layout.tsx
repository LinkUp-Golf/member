'use client'

// The referral-partner workspace shell. Deliberately mirrors the admin
// sidebar's look so the two workspaces feel like one system, but stays a
// separate, much smaller component — a partner only ever sees their own data,
// so none of the admin layout's course/queue plumbing applies.
//
// Middleware is the real gate (see PARTNER_ROUTES in src/middleware.ts); the
// check here only avoids flashing the shell to someone mid-redirect.

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { cn } from '@/lib/utils'
import { FullScreenLoader } from '@/components/ui/Loading'
import { useMemberRoles } from '@/hooks/useMemberRoles'

const NAV_ITEMS = [
  { href: '/partner',           label: 'Overview' },
  { href: '/partner/referrals', label: 'My Referrals' },
]

export default function PartnerLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { isPartner, loading } = useMemberRoles()

  useEffect(() => {
    if (!loading && !isPartner) router.push('/more/referral-partner')
  }, [loading, isPartner, router])

  if (loading) return <FullScreenLoader />
  if (!isPartner) return null

  return (
    <div className="flex min-h-screen bg-gray-50">
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
              Referral Partner
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 overflow-y-auto">
          {NAV_ITEMS.map(item => {
            const active = item.href === '/partner'
              ? pathname === '/partner'
              : pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center px-3 py-2.5 rounded-lg text-sm mb-0.5 transition-colors',
                  active
                    ? 'bg-white/10 text-white font-medium'
                    : 'text-white/55 hover:text-white hover:bg-white/[0.06]'
                )}
              >
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
        {/* Mobile nav — the sidebar is hidden below md */}
        <div className="md:hidden bg-green-950 px-4 py-3 flex items-center gap-1 overflow-x-auto">
          {NAV_ITEMS.map(item => {
            const active = item.href === '/partner'
              ? pathname === '/partner'
              : pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs whitespace-nowrap transition-colors',
                  active ? 'bg-white/10 text-white font-medium' : 'text-white/55'
                )}
              >
                {item.label}
              </Link>
            )
          })}
        </div>

        {children}
      </div>
    </div>
  )
}
