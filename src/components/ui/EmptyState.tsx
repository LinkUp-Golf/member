interface EmptyStateProps {
  icon: string
  title: string
  description?: string
  action?: React.ReactNode
  /** compact — smaller padding, fits inside a feed section card */
  compact?: boolean
}

export default function EmptyState({ icon, title, description, action, compact }: EmptyStateProps) {
  if (compact) {
    return (
      <div
        className="rounded-2xl flex flex-col items-center text-center px-5 py-7"
        style={{ background: 'rgba(0,38,105,0.03)', border: '1.5px dashed rgba(0,38,105,0.10)' }}
      >
        <div className="text-2xl mb-2">{icon}</div>
        <p className="font-sans font-black text-sm text-green-900 mb-1">{title}</p>
        {description && (
          <p className="text-xs leading-relaxed max-w-xs" style={{ color: 'rgba(0,38,105,0.4)' }}>
            {description}
          </p>
        )}
        {action && <div className="mt-3">{action}</div>}
      </div>
    )
  }

  return (
    <div
      className="rounded-2xl flex flex-col items-center text-center px-6 py-10"
      style={{ background: 'rgba(0,38,105,0.04)', border: '1.5px dashed rgba(0,38,105,0.12)' }}
    >
      <div className="text-3xl mb-3">{icon}</div>
      <p className="font-sans font-black text-base text-green-900 mb-1">{title}</p>
      {description && (
        <p className="text-xs leading-relaxed max-w-xs" style={{ color: 'rgba(0,38,105,0.4)' }}>
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
