import { Gift, Bell, Smartphone, FileText, Settings, BadgeDollarSign } from 'lucide-react'
import Icon, { type IconName } from '@/components/ui/Icon'
import { FEATURES } from '@/lib/features'

export interface MoreItem {
  href: string
  label: string
  icon: React.ReactNode
  desc: string
  external?: boolean
}

function svgIcon(name: IconName) {
  return <Icon name={name} className="w-5 h-5" />
}

// Shared between the /more hub page (used on mobile, where the bottom nav's
// "More" tab links here) and the sidebar (tablet+), which lists these same
// items directly instead of hiding them behind a click.
export const MORE_ITEMS: { group: string; items: MoreItem[] }[] = [
  {
    group: 'My account',
    items: [
      { href: '/more/profile', label: 'My Profile', icon: svgIcon('members'), desc: 'Edit your details and golf life' },
      ...(FEATURES.FOCUS_LINKUPS ? [{ href: '/more/focus-linkups', label: 'Focus LinkUps', icon: svgIcon('focus-linkup'), desc: 'Manage your category subscriptions' }] : []),
      { href: '/more/referrals', label: 'Refer a Member', icon: svgIcon('new-member'), desc: 'Invite someone to the community' },
      { href: '/more/referral-partner', label: 'Referral Partner', icon: <BadgeDollarSign className="w-5 h-5" strokeWidth={1.9} />, desc: 'Apply to earn commission on referrals' },
      { href: '/more/guest-access', label: 'Guest Access', icon: svgIcon('visiting-member'), desc: 'Request access to another city' },
    ],
  },
  {
    group: 'Community',
    items: [
      { href: '/more/events', label: 'Member Events', icon: svgIcon('next-round'), desc: 'Browse and submit community events' },
      { href: '/more/announcements', label: 'Announcements', icon: svgIcon('announcement'), desc: 'Community news and updates' },
      { href: '/more/promotions', label: 'Member Offers', icon: <Gift className="w-5 h-5" strokeWidth={1.9} />, desc: 'Exclusive deals for members' },
    ],
  },
  {
    group: 'Settings',
    items: [
      { href: '/more/notifications', label: 'Notification Log', icon: <Bell className="w-5 h-5" strokeWidth={1.9} />, desc: 'View your notification history' },
      { href: '/more/settings', label: 'Preferences', icon: <Settings className="w-5 h-5" strokeWidth={1.9} />, desc: 'Notifications, text size & display' },
      { href: '/more/install', label: 'Install App', icon: <Smartphone className="w-5 h-5" strokeWidth={1.9} />, desc: 'Add LinkUp Golf to your home screen' },
      { href: 'https://www.linkup.golf/terms-and-community-standards', label: 'Terms & Community Standards', icon: <FileText className="w-5 h-5" strokeWidth={1.9} />, desc: 'Our terms of service and community guidelines', external: true },
    ],
  },
]
