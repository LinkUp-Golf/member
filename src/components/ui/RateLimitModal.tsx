'use client'

interface Props {
  title: string
  message: string
  onClose: () => void
}

export function RateLimitBanner({ title, message, onClose }: Props) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 border-t border-amber-200/70 bg-amber-50">
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-semibold text-amber-800 mb-0.5">{title}</p>
        <p className="text-[11px] text-amber-700/90 leading-relaxed">{message}</p>
      </div>
      <button
        onClick={onClose}
        className="flex-shrink-0 mt-0.5 text-amber-700/50 hover:text-amber-800 text-lg leading-none transition-colors"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  )
}
