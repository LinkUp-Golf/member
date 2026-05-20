// ============================================================
// LinkUp Golf — Admin UI Components
// ============================================================
import { cn } from '@/lib/utils'

// ---- Page header --------------------------------------------
export function AdminPageHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6 sm:mb-8">
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-semibold text-gray-900">{title}</h1>
        {description && <p className="text-sm text-gray-500 mt-1">{description}</p>}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  )
}

// ---- Stat card ----------------------------------------------
export function StatCard({
  label,
  value,
  sub,
  colour = 'green',
  large = false,
}: {
  label: string
  value: string | number
  sub?: string
  colour?: 'green' | 'gold' | 'red' | 'blue' | 'gray'
  large?: boolean
}) {
  const colours = {
    green: 'text-green-800',
    gold:  'text-yellow-700',
    red:   'text-red-600',
    blue:  'text-blue-700',
    gray:  'text-gray-500',
  }
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 sm:p-5 shadow-sm">
      <p className="text-xs uppercase tracking-wider text-gray-400 mb-1.5">{label}</p>
      <p className={cn('font-bold', large ? 'text-3xl sm:text-4xl' : 'text-2xl sm:text-3xl', colours[colour])}>
        {value}
      </p>
      {sub && <p className="text-xs text-gray-400 mt-1.5 leading-snug">{sub}</p>}
    </div>
  )
}

// ---- Table --------------------------------------------------
export function AdminTable({
  headers,
  children,
  empty,
}: {
  headers: string[]
  children: React.ReactNode
  empty?: string
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth: '520px' }}>
          <thead>
            <tr className="border-b border-gray-100">
              {headers.map(h => (
                <th
                  key={h}
                  className="text-left px-4 sm:px-5 py-3 text-xs uppercase tracking-wider text-gray-400 font-medium whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
      {empty && (
        <div className="px-5 py-10 text-center text-sm text-gray-400 italic">{empty}</div>
      )}
    </div>
  )
}

export function AdminTr({
  children,
  onClick,
}: {
  children: React.ReactNode
  onClick?: () => void
}) {
  return (
    <tr
      onClick={onClick}
      className={cn(
        'border-b border-gray-50 last:border-0',
        onClick && 'cursor-pointer hover:bg-gray-50 active:bg-gray-100'
      )}
    >
      {children}
    </tr>
  )
}

export function AdminTd({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <td className={cn('px-4 sm:px-5 py-3.5 text-gray-700', className)}>
      {children}
    </td>
  )
}

// ---- Badge --------------------------------------------------
export function Badge({
  label,
  colour = 'gray',
}: {
  label: string
  colour?: 'green' | 'gold' | 'red' | 'blue' | 'gray' | 'yellow'
}) {
  const colours = {
    green:  'bg-green-50 text-green-700',
    gold:   'bg-yellow-50 text-yellow-700',
    yellow: 'bg-yellow-50 text-yellow-700',
    red:    'bg-red-50 text-red-600',
    blue:   'bg-blue-50 text-blue-700',
    gray:   'bg-gray-100 text-gray-600',
  }
  return (
    <span className={cn('text-xs font-medium px-2.5 py-1 rounded-full whitespace-nowrap', colours[colour])}>
      {label}
    </span>
  )
}

// ---- Section card -------------------------------------------
export function AdminCard({
  title,
  children,
  action,
}: {
  title?: string
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
      {title && (
        <div className="flex items-center justify-between px-4 sm:px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800 text-sm">{title}</h2>
          {action}
        </div>
      )}
      <div className="p-4 sm:p-5">{children}</div>
    </div>
  )
}

// ---- Action button ------------------------------------------
export function AdminButton({
  label,
  onClick,
  variant = 'primary',
  size = 'md',
  disabled = false,
}: {
  label: string
  onClick?: () => void
  variant?: 'primary' | 'danger' | 'ghost' | 'gold'
  size?: 'sm' | 'md'
  disabled?: boolean
}) {
  const variants = {
    primary: 'bg-green-900 text-white hover:bg-green-800',
    danger:  'bg-red-50 text-red-600 hover:bg-red-100',
    ghost:   'bg-gray-100 text-gray-600 hover:bg-gray-200',
    gold:    'text-green-900 font-semibold hover:opacity-90',
  }
  const sizes = {
    sm: 'px-3 py-1.5 text-xs rounded-lg',
    md: 'px-4 py-2 text-sm rounded-xl',
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={variant === 'gold' ? { background: '#85bb65' } : undefined}
      className={cn(
        'inline-flex items-center gap-1.5 font-medium transition-colors whitespace-nowrap disabled:opacity-40',
        variants[variant],
        sizes[size]
      )}
    >
      {label}
    </button>
  )
}

// ---- Progress bar -------------------------------------------
export function ProgressBar({
  value,
  max,
  colour = 'green',
}: {
  value: number
  max: number
  colour?: 'green' | 'gold' | 'red'
}) {
  const pct = Math.min(100, Math.round((value / max) * 100))
  const colours = {
    green: 'bg-green-700',
    gold:  'bg-yellow-500',
    red:   'bg-red-500',
  }
  const barColour = pct >= 90 ? 'red' : pct >= 70 ? 'gold' : colour
  return (
    <div className="mt-2">
      <div className="flex justify-between text-xs text-gray-400 mb-1.5">
        <span>{value} / {max}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', colours[barColour])}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
