import { cn } from '@/lib/utils'
import NotificationBell from '@/components/ui/NotificationBell'

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
          <NotificationBell variant="light" />
        </div>
      </div>
    </div>
  )
}
