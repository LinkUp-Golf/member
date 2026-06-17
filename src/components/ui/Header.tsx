import { cn } from '@/lib/utils'
import NotificationBell from '@/components/ui/NotificationBell'
import MessagesIcon from '@/components/ui/MessagesIcon'

interface HeaderProps {
  title: string
  description?: string
  end?: React.ReactNode
  className?: string
  hideMessagesLink?: boolean
}

export default function Header({ title, description, end, className, hideMessagesLink }: HeaderProps) {
  return (
    <div className={cn('top-bar', className)}>
      <div className="flex items-center justify-between">
        <div>
          <div className="font-sans font-black text-2xl capitalize" style={{ color: 'var(--color-gold)' }}>{title}</div>
          {description && <div className="logo-subtitle">{description}</div>}
        </div>
        <div className="flex items-center gap-1">
          {end}
          {!hideMessagesLink && (
            <MessagesIcon />
          )}
          <NotificationBell variant="light" />
        </div>
      </div>
    </div>
  )
}
