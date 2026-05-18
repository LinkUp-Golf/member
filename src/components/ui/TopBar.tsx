'use client'

import { cn } from '@/lib/utils'

interface TopBarProps {
  title: string
  subtitle?: string
  right?: React.ReactNode
  className?: string
}

export default function TopBar({ title, subtitle, right, className }: TopBarProps) {
  return (
    <div className={cn('top-bar', className)}>
      <div className="flex items-center justify-between">
        <div>
          <div className="logo-text">{title}</div>
          {subtitle && <div className="logo-subtitle">{subtitle}</div>}
        </div>
        {/* Replace the above with an <Image> tag once a logo file is provided */}
        {right && <div className="flex items-center gap-2">{right}</div>}
      </div>
    </div>
  )
}
