'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { ChevronRight, ExternalLink, LogOut } from 'lucide-react'
import { useProfile } from '@/hooks/useProfile'
import Avatar from '@/components/ui/Avatar'
import AppShell from '@/components/layout/AppShell'
import { MORE_ITEMS } from '@/lib/nav/moreItems'

export default function MorePage() {
  const { profile, signOut } = useProfile()
  const m = profile

  return (
    <AppShell title="More" description="Settings &amp; account">

      {/* Profile quick-link */}
      {m && (
        <Link
          href="/more/profile"
          className="focus-ring flex items-center gap-4 px-5 py-5 bg-white border-b transition-colors hover:bg-green-50/40 active:bg-green-50/60"
          style={{ borderColor: 'rgba(0,38,105,0.07)' }}
        >
          <Avatar
            firstName={m.first_name}
            lastName={m.last_name}
            avatarUrl={m.profile?.avatar_url}
            size="lg"
          />
          <div className="flex-1 min-w-0">
            <p className="font-bold text-base capitalize" style={{ color: 'var(--color-green-900)' }}>
              {m.first_name} {m.last_name}
            </p>
            <p className="text-sm mt-0.5" style={{ color: 'rgba(0,38,105,0.5)' }}>
              {m.profile?.role_title ?? 'Complete your profile'}
            </p>
            <p className="text-xs mt-1.5 font-semibold" style={{ color: 'var(--color-green-600)' }}>
              View &amp; edit profile →
            </p>
          </div>
          <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: 'rgba(0,38,105,0.2)' }} strokeWidth={1.75} />
        </Link>
      )}

      {/* Navigation groups */}
      <div className="pb-8 space-y-6 pt-6 px-5">
        {MORE_ITEMS.map((group, gi) => (
          <motion.div
            key={group.group}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: gi * 0.05, ease: [0.16, 1, 0.3, 1] }}
          >
            <p className="section-label mb-2.5">{group.group}</p>
            <div className="card">
              {group.items.map((item, i) => (
                <Link
                  key={item.href}
                  href={item.href}
                  target={item.external ? '_blank' : undefined}
                  rel={item.external ? 'noopener noreferrer' : undefined}
                  className="focus-ring flex items-center gap-3.5 px-4 py-4 transition-colors hover:bg-green-50/60 active:bg-green-50"
                  style={{
                    borderBottom: i < group.items.length - 1
                      ? '0.5px solid rgba(0,38,105,0.06)'
                      : 'none',
                  }}
                >
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: 'rgba(0,38,105,0.05)', color: 'rgba(0,38,105,0.55)' }}>
                    {item.icon}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold" style={{ color: 'var(--color-green-900)' }}>
                      {item.label}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'rgba(0,38,105,0.42)' }}>
                      {item.desc}
                    </p>
                  </div>
                  {item.external
                    ? <ExternalLink className="w-4 h-4 flex-shrink-0" style={{ color: 'rgba(0,38,105,0.2)' }} strokeWidth={1.75} />
                    : <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: 'rgba(0,38,105,0.2)' }} strokeWidth={1.75} />
                  }
                </Link>
              ))}
            </div>
          </motion.div>
        ))}

        {/* Sign out */}
        <button
          onClick={signOut}
          className="focus-ring w-full flex items-center justify-center gap-1.5 text-center text-sm py-2 rounded-lg transition-colors hover:text-red-500"
          style={{ color: 'rgba(0,38,105,0.35)' }}
        >
          <LogOut className="w-3.5 h-3.5" strokeWidth={2} />
          Sign out
        </button>

        <p className="text-center text-xs" style={{ color: 'rgba(0,38,105,0.18)' }}>
          LinkUp Golf · Member Portal · v1.0
        </p>
      </div>
    </AppShell>
  )
}
