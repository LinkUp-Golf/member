import { memo } from 'react'
import {
  Home,
  CalendarPlus,
  Users,
  MessageCircle,
  Menu,
  Megaphone,
  Target,
  UserPlus,
  CalendarClock,
  Flag,
  Plane,
  type LucideIcon,
} from 'lucide-react'

const ICONS: Record<string, LucideIcon> = {
  home: Home,
  book: CalendarPlus,
  members: Users,
  messages: MessageCircle,
  more: Menu,
  announcement: Megaphone,
  'focus-linkup': Target,
  'new-member': UserPlus,
  'next-round': CalendarClock,
  'tee-time': Flag,
  'visiting-member': Plane,
}

export type IconName = keyof typeof ICONS

interface IconProps {
  name: IconName
  className?: string
  strokeWidth?: number
}

function Icon({ name, className = 'w-5 h-5', strokeWidth = 2 }: IconProps) {
  const LucideIconComponent = ICONS[name]
  if (!LucideIconComponent) return null
  return <LucideIconComponent className={className} strokeWidth={strokeWidth} aria-hidden="true" />
}

export default memo(Icon)
