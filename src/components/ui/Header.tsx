import Link from 'next/link'
import { cn } from '@/lib/utils'
import NotificationBell from '@/components/ui/NotificationBell'
import Icon from '@/components/ui/Icon'

interface HeaderProps {
  title: string
  description?: string
  end?: React.ReactNode
  className?: string
}

export default function Header({ title, description, end, className }: HeaderProps) {
  return (
    <div className={cn('top-bar', className)}>
      <div className="flex items-center justify-between">
        <div>
          <div className="font-sans font-black text-2xl capitalize" style={{ color: 'var(--color-gold)' }}>{title}</div>
          {description && <div className="logo-subtitle">{description}</div>}
        </div>
        <div className="flex items-center gap-1">
          {end}
          <Link
            href="/messages"
            className="relative flex items-center justify-center w-9 h-9 rounded-xl text-white/70 hover:text-white hover:bg-white/10 transition-colors md:hidden"
            aria-label="Messages"
          >
            <Icon name="messages" className="w-5 h-5" />
          </Link>
          <NotificationBell variant="light" />
        </div>
      </div>
    </div>
  )
}
