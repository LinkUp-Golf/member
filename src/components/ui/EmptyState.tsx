import type { ReactNode } from 'react'

interface EmptyStateProps {
  /** A Lucide icon element (e.g. <Search />) is preferred; a string emoji is still supported. */
  icon: ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  /** compact — smaller padding, fits inside a feed section card */
  compact?: boolean
}

export default function EmptyState({ icon, title, description, action, compact }: EmptyStateProps) {
  const isGlyph = typeof icon === 'string'

  return (
    <div
      className={`rounded-2xl flex flex-col items-center text-center ${compact ? 'px-5 py-7' : 'px-6 py-10'}`}
      style={{ background: 'rgba(0,38,105,0.03)', border: '1.5px dashed rgba(0,38,105,0.10)' }}
    >
      <div
        className={`flex items-center justify-center rounded-full mb-3 ${compact ? 'w-11 h-11' : 'w-14 h-14'}`}
        style={{ background: 'rgba(0,38,105,0.06)', color: 'var(--color-green-600)' }}
      >
        {isGlyph ? <span className={compact ? 'text-xl' : 'text-2xl'}>{icon}</span> : icon}
      </div>
      <p className={`font-sans font-black text-green-900 mb-1 ${compact ? 'text-sm' : 'text-base'}`}>{title}</p>
      {description && (
        <p className="text-xs leading-relaxed max-w-xs" style={{ color: 'rgba(0,38,105,0.4)' }}>
          {description}
        </p>
      )}
      {action && <div className={compact ? 'mt-3' : 'mt-4'}>{action}</div>}
    </div>
  )
}
