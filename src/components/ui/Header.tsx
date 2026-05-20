import { cn } from '@/lib/utils'

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
          <div className="logo-text">{title}</div>
          {description && <div className="logo-subtitle">{description}</div>}
        </div>
        {end && <div className="flex items-center gap-2">{end}</div>}
      </div>
    </div>
  )
}
