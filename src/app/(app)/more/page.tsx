'use client'

import Link from 'next/link'
import { useAuthStore } from '@/store/auth'
import { capitalizeName } from '@/lib/utils'
import Avatar from '@/components/ui/Avatar'
import AppShell from '@/components/layout/AppShell'

const MORE_ITEMS = [
  {
    group: 'My account',
    items: [
      { href: '/more/profile',       label: 'My Profile',          icon: '👤', desc: 'Edit your details and golf life' },
      { href: '/more/focus-linkups', label: 'Focus LinkUps',       icon: '🎯', desc: 'Manage your category subscriptions' },
      { href: '/more/referrals',     label: 'Refer a Member',      icon: '🤝', desc: 'Invite someone to the community' },
      { href: '/more/guest-access',  label: 'Guest Access',        icon: '✈️',  desc: 'Request access to another course' },
    ],
  },
  {
    group: 'Community',
    items: [
      { href: '/more/events',        label: 'Member Events',       icon: '📅', desc: 'Browse and submit community events' },
      { href: '/more/announcements', label: 'Announcements',       icon: '📢', desc: 'Community news and updates' },
      { href: '/more/promotions',    label: 'Member Offers',       icon: '🎁', desc: 'Exclusive deals for members' },
    ],
  },
  {
    group: 'Settings',
    items: [
      { href: '/more/settings',      label: 'Notifications',       icon: '🔔', desc: 'Manage push notification preferences' },
    ],
  },
]

export default function MorePage() {
  const { user, signOut } = useAuthStore()
  const m = user?.member

  return (
    <AppShell title="More" description="Settings &amp; account">

      {/* Profile quick-link */}
      {m && (
        <Link
          href="/more/profile"
          className="flex items-center gap-4 px-5 py-5 bg-white border-b transition-colors hover:bg-green-50/40"
          style={{ borderColor: 'rgba(0,38,105,0.07)' }}
        >
          <Avatar
            firstName={m.first_name}
            lastName={m.last_name}
            avatarUrl={m.profile?.avatar_url}
            size="lg"
          />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-base" style={{ color: 'var(--color-green-900)' }}>
              {capitalizeName(m.first_name)} {capitalizeName(m.last_name)}
            </p>
            <p className="text-sm mt-0.5" style={{ color: 'rgba(0,38,105,0.5)' }}>
              {m.profile?.role_title ?? 'Complete your profile'}
            </p>
            <p className="text-xs mt-1.5 font-medium" style={{ color: 'var(--color-green-600)' }}>
              View &amp; edit profile →
            </p>
          </div>
          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"
            strokeWidth={1.5} style={{ color: 'rgba(0,38,105,0.2)' }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </Link>
      )}

      {/* Navigation groups */}
      <div className="pb-8 space-y-6 pt-6 px-5">
        {MORE_ITEMS.map(group => (
          <div key={group.group}>
            <p className="section-label mb-2.5">{group.group}</p>
            <div className="card">
              {group.items.map((item, i) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-3.5 px-4 py-4 transition-colors hover:bg-green-50/60"
                  style={{
                    borderBottom: i < group.items.length - 1
                      ? '0.5px solid rgba(0,38,105,0.06)'
                      : 'none',
                  }}
                >
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                    style={{ background: 'rgba(0,38,105,0.05)' }}>
                    {item.icon}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium" style={{ color: 'var(--color-green-900)' }}>
                      {item.label}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'rgba(0,38,105,0.42)' }}>
                      {item.desc}
                    </p>
                  </div>
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"
                    strokeWidth={1.5} style={{ color: 'rgba(0,38,105,0.2)' }}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </Link>
              ))}
            </div>
          </div>
        ))}

        {/* Sign out */}
        <button
          onClick={signOut}
          className="w-full text-center text-sm py-2 transition-colors"
          style={{ color: 'rgba(0,38,105,0.3)' }}
        >
          Sign out
        </button>

        <p className="text-center text-xs" style={{ color: 'rgba(0,38,105,0.18)' }}>
          LinkUp Golf · Member Portal · v1.0
        </p>
      </div>
    </AppShell>
  )
}
