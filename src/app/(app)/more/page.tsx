'use client'

import Link from 'next/link'
import { useAuthStore } from '@/store/auth'
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
        <Link href="/more/profile" className="flex items-center gap-4 px-5 py-5 bg-white border-b border-green-900/08">
          <Avatar
            firstName={m.first_name}
            lastName={m.last_name}
            avatarUrl={m.profile?.avatar_url}
            size="lg"
          />
          <div className="flex-1">
            <p className="font-medium text-green-900">{m.first_name} {m.last_name}</p>
            <p className="text-sm text-green-900/55 mt-0.5">
              {m.profile?.role_title ?? 'Complete your profile'}
            </p>
            <p className="text-xs text-green-600 mt-1">View & edit profile →</p>
          </div>
        </Link>
      )}

      {/* Navigation groups */}
      <div className="pb-8 space-y-6 pt-5 px-5">
        {MORE_ITEMS.map(group => (
          <div key={group.group}>
            <p className="section-label mb-2">{group.group}</p>
            <div className="card">
              {group.items.map((item, i) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 px-4 py-3.5 ${
                    i < group.items.length - 1 ? 'border-b border-green-900/08' : ''
                  }`}
                >
                  <span className="text-xl w-8 text-center flex-shrink-0">{item.icon}</span>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-green-900">{item.label}</p>
                    <p className="text-xs text-green-900/45 mt-0.5">{item.desc}</p>
                  </div>
                  <ChevronRight />
                </Link>
              ))}
            </div>
          </div>
        ))}

        {/* Sign out */}
        <button
          onClick={signOut}
          className="w-full text-center text-sm text-green-900/35 py-2"
        >
          Sign out
        </button>

        <p className="text-center text-xs text-green-900/20">
          LinkUp Golf · Member Portal · v1.0
        </p>
      </div>
    </AppShell>
  )
}

function ChevronRight() {
  return (
    <svg className="w-4 h-4 text-green-900/25 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
    </svg>
  )
}
