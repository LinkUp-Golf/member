'use client'

import Link from 'next/link'
import { useProfile } from '@/hooks/useProfile'
import Avatar from '@/components/ui/Avatar'
import AppShell from '@/components/layout/AppShell'
import Icon, { type IconName } from '@/components/ui/Icon'
import { FEATURES } from '@/lib/features'

type SvgIcon = { type: 'svg'; name: IconName }
type EmojiIcon = { type: 'emoji'; char: string }
type ItemIcon = SvgIcon | EmojiIcon

const MORE_ITEMS: { group: string; items: { href: string; label: string; icon: ItemIcon; desc: string }[] }[] = [
  {
    group: 'My account',
    items: [
      { href: '/more/profile',       label: 'My Profile',     icon: { type: 'svg', name: 'members' },          desc: 'Edit your details and golf life' },
      ...(FEATURES.FOCUS_LINKUPS ? [{ href: '/more/focus-linkups', label: 'Focus LinkUps', icon: { type: 'svg', name: 'focus-linkup' } as ItemIcon, desc: 'Manage your category subscriptions' }] : []),
      { href: '/more/referrals',     label: 'Refer a Member', icon: { type: 'svg', name: 'new-member' },       desc: 'Invite someone to the community' },
      { href: '/more/guest-access',  label: 'Guest Access',   icon: { type: 'svg', name: 'visiting-member' },  desc: 'Request access to another city' },
    ],
  },
  {
    group: 'Community',
    items: [
      { href: '/more/events',        label: 'Member Events',  icon: { type: 'svg', name: 'next-round' },    desc: 'Browse and submit community events' },
      { href: '/more/announcements', label: 'Announcements',  icon: { type: 'svg', name: 'announcement' },  desc: 'Community news and updates' },
      { href: '/more/promotions',    label: 'Member Offers',  icon: { type: 'emoji', char: '🎁' },           desc: 'Exclusive deals for members' },
    ],
  },
  {
    group: 'Settings',
    items: [
      { href: '/more/notifications', label: 'Notification Log', icon: { type: 'emoji', char: '🔔' },  desc: 'View your notification history' },
      { href: '/more/settings',      label: 'Preferences',      icon: { type: 'svg', name: 'more' },  desc: 'Notifications, text size & display' },
      { href: '/more/install',       label: 'Install App',       icon: { type: 'emoji', char: '📲' }, desc: 'Add LinkUp Golf to your home screen' },
    ],
  },
]

function ItemIconEl({ icon }: { icon: ItemIcon }) {
  if (icon.type === 'svg') {
    return <Icon name={icon.name} className="w-5 h-5" />
  }
  return <span className="text-lg leading-none">{icon.char}</span>
}

export default function MorePage() {
  const { profile, signOut } = useProfile()
  const m = profile

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
            <p className="font-semibold text-base capitalize" style={{ color: 'var(--color-green-900)' }}>
              {m.first_name} {m.last_name}
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
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: 'rgba(0,38,105,0.05)', color: 'rgba(0,38,105,0.55)' }}>
                    <ItemIconEl icon={item.icon} />
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
